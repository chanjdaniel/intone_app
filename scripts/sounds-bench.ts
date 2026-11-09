// Runs each sound model of docs/sounds.md in a Worker in desktop Chromium,
// on one thread, as the app runs its models, and prints what docs/sounds.md
// records: the file's size, the time to fetch it from a local server and
// to open its session, the time to run it on a 6 s take, and the page's
// peak memory. Each model gets a fresh browser; the peak is the highest
// resident memory (VmHWM) of the browser's renderer processes, read from
// /proc, so it holds on Linux only.
//
// `npm run sounds:bench`; `--model <id>` runs one model, `--runs <n>` sets
// how many timed runs follow the first (5). Run with
// `node --import ./scripts/source-imports.ts`, as the npm script does.

import { Schema } from 'effect'
import { readFileSync, readdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'

import {
  fixtureSamples16k,
  readSoundFeatures,
} from '../tests/support/sound-features.ts'
import {
  loadSoundModel,
  soundModel,
  soundModelInput,
  soundModels,
} from '../tests/support/sound-models.ts'
import { fixtureId, phrases } from '../tests/support/voice-fixture-set.ts'

const root = join(import.meta.dirname, '..')
const { values } = parseArgs({
  options: {
    model: { type: 'string', multiple: true },
    runs: { type: 'string', default: '5' },
  },
})
const models =
  values.model === undefined ? soundModels : values.model.map(soundModel)
const runs = Number(values.runs)

// A 6 s take: the longest fixture, said slower, with silence after it.
const takeSamples = new Float32Array(6 * 16_000)
takeSamples.set(
  fixtureSamples16k('kyou-wa-eki-de/kyushu-sora/slower').subarray(
    0,
    takeSamples.length,
  ),
)

// The Worker: on 'bench', fetches and opens the model and times its runs
// on the take; on 'check', runs it on each fixture of the check and
// answers how far its frames are from the ones the study read in Node.
const worker = `
import * as ort from '/ort/ort.wasm.bundle.min.mjs'
ort.env.wasm.numThreads = 1
ort.env.wasm.proxy = false
ort.env.wasm.wasmPaths = '/ort/'
let session
const floats = async url => new Float32Array(await (await fetch(url)).arrayBuffer())
const run = async (input, dims) => {
  const result = await session.run({
    [session.inputNames[0]]: new ort.Tensor('float32', input, dims),
  })
  const output = result[session.outputNames[0]]
  const data = output.data.slice()
  for (const tensor of Object.values(result)) tensor.dispose()
  return data
}
self.onmessage = async ({ data }) => {
  try {
    if (data.kind === 'bench') {
      const fetchStarted = performance.now()
      const bytes = new Uint8Array(await (await fetch(data.modelUrl)).arrayBuffer())
      const fetched = performance.now() - fetchStarted
      const input = await floats('/input.f32')
      const loadStarted = performance.now()
      session = await ort.InferenceSession.create(bytes, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      })
      const loaded = performance.now() - loadStarted
      const times = []
      for (let at = 0; at <= data.runs; at++) {
        const started = performance.now()
        await run(input.slice(), data.dims)
        times.push(performance.now() - started)
      }
      self.postMessage({ fetched, loaded, times })
    } else {
      const differences = []
      for (const check of data.checks) {
        const frames = await run(await floats(check.input), check.dims)
        const expected = await floats(check.expected)
        let largest = 0
        let worst = 0
        for (let i = 0; i < expected.length; i++) {
          largest = Math.max(largest, Math.abs(expected[i]))
          worst = Math.max(worst, Math.abs(frames[i] - expected[i]))
        }
        differences.push(worst / largest)
      }
      self.postMessage({ differences })
    }
  } catch (error) {
    self.postMessage({ error: String(error) })
  }
}
`

// Fixtures each model also runs in the Worker, whose frames must match
// the study's from Node: every phrase's right take in one voice, clean
// and in room noise.
const checkIds = phrases.flatMap(phrase =>
  (['clean', 'room'] as const).map(condition =>
    fixtureId(phrase.id, 'kurono-takehiro', 'right', condition),
  ),
)

// What the Worker answers to each message.
const BenchAnswer = Schema.Struct({
  fetched: Schema.optionalKey(Schema.Finite),
  loaded: Schema.optionalKey(Schema.Finite),
  times: Schema.optionalKey(Schema.Array(Schema.Finite)),
  error: Schema.optionalKey(Schema.String),
})
const CheckAnswer = Schema.Struct({
  differences: Schema.optionalKey(Schema.Array(Schema.Finite)),
  error: Schema.optionalKey(Schema.String),
})

const ortDirectory = join(root, 'node_modules', 'onnxruntime-web', 'dist')

// Every descendant of `pid`, by each process's parent in /proc.
const descendantsOf = (pid: number): ReadonlyArray<number> => {
  const parents = new Map<number, number>()
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue
    try {
      const stat = readFileSync(`/proc/${entry}/stat`, 'utf8')
      const parent = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1])
      parents.set(Number(entry), parent)
    } catch {
      // The process ended while it was read.
    }
  }
  const found: Array<number> = []
  const walk = (of: number) => {
    for (const [child, parent] of parents) {
      if (parent === of) {
        found.push(child)
        walk(child)
      }
    }
  }
  walk(pid)
  return found
}

const rendererPeakBytes = (browserPid: number): number =>
  Math.max(
    0,
    ...descendantsOf(browserPid).map(pid => {
      try {
        if (
          !readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes(
            '--type=renderer',
          )
        )
          return 0
        const status = readFileSync(`/proc/${pid}/status`, 'utf8')
        return Number(/VmHWM:\s+(\d+) kB/.exec(status)?.[1] ?? 0) * 1024
      } catch {
        return 0
      }
    }),
  )

const findBrowserPid = (profile: string): number => {
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue
    try {
      const command = readFileSync(`/proc/${entry}/cmdline`, 'utf8')
      if (command.includes(profile) && !command.includes('--type=')) {
        return Number(entry)
      }
    } catch {
      // The process ended while it was read.
    }
  }
  throw new Error('the browser process was not found')
}

for (const model of models) {
  const bytes = await loadSoundModel(model)
  const take = soundModelInput(model, takeSamples)
  const checks = checkIds.map(id => ({
    input: soundModelInput(model, fixtureSamples16k(id)),
    expected: readSoundFeatures(model, id).data,
  }))
  const floats = (data: Float32Array) =>
    new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  const server = createServer((request, response) => {
    const url = request.url ?? '/'
    const send = (type: string, body: string | Uint8Array) => {
      response.writeHead(200, { 'content-type': type })
      response.end(body)
    }
    if (url === '/') send('text/html', '<!doctype html><title>bench</title>')
    else if (url === '/worker.mjs') send('text/javascript', worker)
    else if (url === '/model.onnx') send('application/octet-stream', bytes)
    else if (url === '/input.f32')
      send('application/octet-stream', floats(take.data))
    else if (url.startsWith('/check/')) {
      const [, , index, kind] = url.split('/')
      const check = checks[Number(index)]
      if (check === undefined) {
        response.writeHead(404)
        response.end()
        return
      }
      send(
        'application/octet-stream',
        floats(kind === 'input' ? check.input.data : check.expected),
      )
    } else if (url.startsWith('/ort/')) {
      const file = url.slice('/ort/'.length)
      send(
        file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript',
        readFileSync(join(ortDirectory, file)),
      )
    } else {
      response.writeHead(404)
      response.end()
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port =
    typeof address === 'object' && address !== null ? address.port : 0
  const profile = await mkdtemp(join(tmpdir(), 'intone-sounds-bench-'))
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
  })
  try {
    const page = context.pages()[0] ?? (await context.newPage())
    await page.goto(`http://127.0.0.1:${port}/`)
    const browserPid = findBrowserPid(profile)
    const before = rendererPeakBytes(browserPid)
    // Strings, since this file is type checked without the DOM's types.
    const ask = (message: unknown): Promise<unknown> =>
      page.evaluate(`new Promise(resolve => {
        globalThis.benchWorker ??= new Worker('/worker.mjs', { type: 'module' })
        globalThis.benchWorker.onmessage = event => resolve(event.data)
        globalThis.benchWorker.onerror = event => resolve({ error: event.message })
        globalThis.benchWorker.postMessage(${JSON.stringify(message)})
      })`)
    const result = await ask({
      kind: 'bench',
      modelUrl: '/model.onnx',
      dims: take.dims,
      runs,
    })
    const peak = rendererPeakBytes(browserPid)
    const checked = Schema.decodeUnknownSync(CheckAnswer)(
      await ask({
        kind: 'check',
        checks: checks.map((check, index) => ({
          input: `/check/${index}/input`,
          expected: `/check/${index}/expected`,
          dims: check.input.dims,
        })),
      }),
    )
    const timing = Schema.decodeUnknownSync(BenchAnswer)(result)
    const later = (timing.times ?? []).slice(1).sort((a, b) => a - b)
    console.log(
      JSON.stringify({
        model: model.id,
        browser: context.browser()?.version(),
        bytes: model.bytes,
        error: timing.error,
        fetchMs: Math.round(timing.fetched ?? Number.NaN),
        loadMs: Math.round(timing.loaded ?? Number.NaN),
        firstRunMs: Math.round(timing.times?.[0] ?? Number.NaN),
        medianRunMs: Math.round(later[later.length >> 1] ?? Number.NaN),
        rendererPeakMiB: Math.round(peak / 2 ** 20),
        rendererBeforeMiB: Math.round(before / 2 ** 20),
        // The largest difference from Node's frames over the check's
        // fixtures, as a share of the largest value in them.
        checkDifference:
          checked.error ?? Math.max(...(checked.differences ?? [])),
      }),
    )
  } finally {
    await context.close()
    server.close()
    await rm(profile, { recursive: true, force: true })
  }
}
