// Writes docs/transcription-study.md: how the app's own text Worker
// (src/workers/text.worker.ts) writes out the LibriVox CC0 clips in
// fixtures/real/, with each model, on WebAssembly and on WebGPU: the
// character error against the clips' public-domain texts
// (fixtures/real/<clip>.txt), counted on the written form and on kana,
// how often the text matched to the lines goes wrong at a line's edge,
// and how fast each runs.
//
//   npm run text:study -- --run [--device wasm|webgpu] [--model <id>]
//       runs the Worker in Chromium on the built app (`npm run build`
//       first) and keeps what it wrote in .cache/text-study/; WebGPU runs
//       headed, since headless Chromium reaches only a software GPU here
//       (docs/transcription.md), so a window opens while it runs
//   npm run text:study
//       writes the document from what is kept; `--out <file>` writes
//       elsewhere
//
// Each clip is cut into lines by the app's own code on the real models,
// as docs/cut-study.md does, and resampled to 16 kHz by the app's own
// resampler (the app decodes an upload with the browser's). Kana are
// OpenJTalk's, through VOICEVOX CORE's binding (scripts/voicevox/kana.py,
// which `npm run fixtures:voices-setup` sets up), read alike for the
// reference and what a model wrote. Run with
// `node --import ./scripts/source-imports.ts`, as the npm script does.

import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'
import { preview } from 'vite'

import { modelVersion, readModelList } from '../build/models.ts'
import {
  onnxRuntimeDirectory,
  textRuntimeFiles,
  textRuntimeVersion,
} from '../build/onnx-runtime.ts'
import { decodeWav } from '../src/engine/audio/wav.ts'
import { analyseClip } from '../src/engine/cut/clip.ts'
import { resample } from '../src/engine/pitch/resample.ts'
import { lineTextsOf } from '../src/engine/text/match.ts'
import type { TextPiece } from '../src/engine/text/pieces.ts'
import { type Span, textWindows } from '../src/engine/text/windows.ts'
import { loadSileroModel, withSilero } from '../tests/support/silero.ts'
import { loadSwiftF0Model, withSwiftF0 } from '../tests/support/swift-f0.ts'
import {
  type StudyRun,
  normalisedText,
  studyClips,
  studyDevices,
  studyModels,
  transcriptionStudy,
} from '../tests/support/transcription-study.ts'

const root = join(import.meta.dirname, '..')
const cache = join(root, '.cache', 'text-study')
const { values } = parseArgs({
  options: {
    run: { type: 'boolean', default: false },
    device: { type: 'string', multiple: true },
    model: { type: 'string', multiple: true },
    port: { type: 'string', default: '4481' },
    out: {
      type: 'string',
      default: join(root, 'docs', 'transcription-study.md'),
    },
  },
})

const rate = 16_000

const mono16k = (clip: string): Float32Array => {
  const wav = decodeWav(
    readFileSync(join(root, 'fixtures', 'real', `${clip}.wav`)),
  )
  const [first, ...others] = wav.channels
  const mixed = Float32Array.from(
    first ?? [],
    (sample, i) =>
      others.reduce((sum, channel) => sum + (channel[i] ?? 0), sample) /
      wav.channels.length,
  )
  return resample(mixed, wav.sampleRate, rate)
}

const dictionary = join(
  root,
  '.cache',
  'voicevox',
  'dict',
  'open_jtalk_dic_utf_8-1.11',
)

const kanaOf = (texts: ReadonlyArray<string>): ReadonlyArray<string> => {
  const read: unknown = JSON.parse(
    execFileSync(
      join(root, '.venv', 'bin', 'python'),
      ['-I', join(root, 'scripts', 'voicevox', 'kana.py'), dictionary],
      { input: JSON.stringify(texts), encoding: 'utf8' },
    ),
  )
  if (!Array.isArray(read) || read.some(each => typeof each !== 'string')) {
    throw new Error('scripts/voicevox/kana.py answered something else')
  }
  return read
}

// Each line alone, reaching at most 0.2 s past its edges and never into a
// neighbour's half of the pause, so no two windows share a sound.
const lineWindows = (
  lines: ReadonlyArray<Span>,
  seconds: number,
): ReadonlyArray<Span> =>
  lines.map((line, k) => {
    const before = lines[k - 1]
    const after = lines[k + 1]
    return {
      from: Math.max(
        0,
        line.from - 0.2,
        before === undefined ? 0 : (before.to + line.from) / 2,
      ),
      to: Math.min(
        seconds,
        line.to + 0.2,
        after === undefined ? seconds : (line.to + after.from) / 2,
      ),
    }
  })

// What runs in the page: the app's own text Worker, spoken to by its
// protocol (src/workers/text-protocol.ts); the model is fetched once
// first, so the times are of the reading alone.
const inPage = `async input => {
  const bytes = Uint8Array.from(atob(input.samples), c => c.charCodeAt(0))
  const samples = new Float32Array(bytes.buffer)
  const worker = new Worker(input.workerUrl, { type: 'module', name: 'text' })
  const waiting = []
  const replies = []
  worker.onmessage = ({ data }) => {
    replies.push({ at: performance.now(), reply: data })
    waiting.shift()?.(data)
  }
  const next = () => new Promise(resolve => waiting.push(resolve))
  const until = async tag => {
    for (;;) {
      const reply = await next()
      if (reply._tag === tag) return reply
      if (reply._tag === 'Failed') throw new Error(String(reply.reason))
    }
  }
  worker.postMessage({ _tag: 'Load', modelsRoot: input.modelsRoot, wasm: input.wasm, mjs: input.mjs })
  await until('Loaded')
  worker.postMessage({ _tag: 'Download', model: input.model })
  await until('Downloaded')
  const results = []
  for (const windows of input.runs) {
    replies.length = 0
    const posted = performance.now()
    worker.postMessage({ _tag: 'Transcribe', model: input.model, samples: samples.slice(), windows })
    const done = await until('Transcribed')
    const firstRead = replies.find(({ reply }) => reply._tag === 'Progress' && reply.step === 'Transcribing')?.at ?? posted
    results.push({ device: done.device, pieces: done.pieces, openMilliseconds: firstRead - posted, readMilliseconds: performance.now() - firstRead })
  }
  worker.postMessage({ _tag: 'Close' })
  await until('Closed')
  return results
}`

// The GPU WebGPU reaches in the page, if any.
const gpuInPage = `(async () => {
  const adapter = 'gpu' in navigator ? await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }) : null
  return adapter === null ? 'none' : adapter.info.vendor + ' ' + adapter.info.architecture + (adapter.info.isFallbackAdapter ? ' (software)' : '')
})()`

type PageRun = Readonly<{
  device: string
  pieces: ReadonlyArray<TextPiece>
  openMilliseconds: number
  readMilliseconds: number
}>

// Each clip's reference text and its kana, read again when the text
// changed.
const keepReferences = (): void => {
  mkdirSync(cache, { recursive: true })
  for (const clip of studyClips) {
    const text = readFileSync(
      join(root, 'fixtures', 'real', `${clip}.txt`),
      'utf8',
    ).trim()
    const path = join(cache, `${clip}.reference.json`)
    const kept: unknown = existsSync(path)
      ? JSON.parse(readFileSync(path, 'utf8'))
      : null
    if (
      typeof kept !== 'object' ||
      kept === null ||
      Reflect.get(kept, 'text') !== text
    ) {
      writeFileSync(path, JSON.stringify({ text, kana: kanaOf([text])[0] }))
    }
  }
}

const run = async (): Promise<void> => {
  const dist = join(root, 'dist', 'assets')
  const workerFile = readdirSync(dist).find(file =>
    /^text\.worker-.*\.js$/.test(file),
  )
  if (workerFile === undefined) {
    throw new Error('No built text Worker: run `npm run build` first.')
  }
  const models = await readModelList(join(root, 'models.json'))
  const ortDirectory = onnxRuntimeDirectory(await textRuntimeVersion())
  const [speechModel, pitchModel] = await Promise.all([
    loadSileroModel(),
    loadSwiftF0Model(),
  ])
  const clips = await withSilero(speechModel, speech =>
    withSwiftF0(pitchModel, async pitch => {
      const cut = []
      for (const clip of studyClips) {
        const samples = mono16k(clip)
        const lines = await analyseClip(samples, { speech, pitch }, () => {})
        cut.push({
          clip,
          samples,
          lines: lines.map(line => ({
            from: line.from / rate,
            to: line.to / rate,
          })),
        })
      }
      return cut
    }),
  )
  keepReferences()
  const port = Number(values.port)
  const server = await preview({
    root,
    preview: { port, strictPort: true },
    logLevel: 'error',
  })
  try {
    const devices = values.device ?? [...studyDevices]
    for (const device of devices) {
      const browser = await chromium.launch(
        device === 'webgpu'
          ? {
              headless: false,
              args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'],
            }
          : {},
      )
      const page = await browser.newPage()
      await page.goto(`http://localhost:${port}/credits`)
      const gpu = String(await page.evaluate(gpuInPage))
      for (const modelId of values.model ?? [...studyModels]) {
        const model = models.find(each => each.id === modelId)
        if (model === undefined) {
          throw new Error(`models.json lists no ${modelId}`)
        }
        for (const { clip, samples, lines } of clips) {
          const seconds = samples.length / rate
          const input = {
            workerUrl: `/assets/${workerFile}`,
            modelsRoot: '/models/',
            wasm: `/${ortDirectory}${textRuntimeFiles[0]}`,
            mjs: `/${ortDirectory}${textRuntimeFiles[1]}`,
            model: {
              name: `${model.id}/${modelVersion(model)}`,
              files: model.files.map(({ path, bytes }) => ({ path, bytes })),
            },
            samples: Buffer.from(
              samples.buffer,
              samples.byteOffset,
              samples.byteLength,
            ).toString('base64'),
            runs: [textWindows(lines, seconds), lineWindows(lines, seconds)],
          }
          const ran: ReadonlyArray<PageRun> = await page.evaluate(
            `(${inPage})(${JSON.stringify(input)})`,
          )
          const [whole, alone] = ran
          if (whole === undefined || alone === undefined) {
            throw new Error('The text Worker gave no transcript')
          }
          const pieces = whole.pieces
          const matched = lineTextsOf(pieces, lines)
          const windows = lineWindows(lines, seconds)
          const ownTexts = windows.map(window =>
            alone.pieces
              .filter(
                piece => piece.from >= window.from && piece.from < window.to,
              )
              .map(piece => piece.text)
              .join(''),
          )
          const text = pieces.map(piece => piece.text).join('')
          const [kana = ''] = kanaOf([text])
          const result: StudyRun = {
            clip,
            model: model.id,
            device,
            ranOn: String(whole.device),
            gpu,
            seconds,
            windows: textWindows(lines, seconds).length,
            openMilliseconds: Math.round(Number(whole.openMilliseconds)),
            readMilliseconds: Math.round(Number(whole.readMilliseconds)),
            text,
            kana,
            lines,
            matched,
            ownTexts,
          }
          writeFileSync(
            join(cache, `${clip}.${model.id}.${device}.json`),
            JSON.stringify(result, null, 1),
          )
          console.log(
            clip,
            model.id,
            device,
            whole.device,
            result.readMilliseconds,
            'ms',
            normalisedText(text).slice(0, 40),
          )
        }
      }
      await browser.close()
    }
  } finally {
    await new Promise<void>(resolve => server.httpServer.close(() => resolve()))
  }
}

const write = (): void => {
  keepReferences()
  const document = transcriptionStudy(cache, root)
  writeFileSync(values.out, document)
  console.log(`Wrote ${values.out}.`)
}

if (values.run) {
  await run()
}
if (existsSync(cache)) {
  write()
} else {
  console.error('Nothing kept yet in .cache/text-study/: run with --run first.')
  process.exit(1)
}
