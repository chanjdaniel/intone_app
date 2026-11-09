// Writes the labelled fixtures in many voices (fixtures/README.md):
//
// - fixtures/noise/: the room noise, cut from its Wikimedia Commons file;
// - fixtures/real/: stretches of LibriVox's CC0 Japanese readings;
// - fixtures/voices/<phrase>/<voice>/<variant>.wav and .json: each phrase
//   in each VOICEVOX voice and variant, then its .room and .phone
//   versions, and fixtures/voices/voices.json, each voice's measured span.
//
// `npm run fixtures:voices`, after `npm run fixtures:voices-setup`, runs
// four stages in order: `noise`, `real` and `voices` make the sources
// (VOICEVOX's output, the readings, the noise), which need VOICEVOX CORE,
// the network once and ffmpeg; `derived` makes the rest from them in Node
// alone, which CI checks byte for byte (tests/scripts/voice-fixtures.test.ts).
// `--stage <name>` runs only the stages named, `--out <dir>` writes
// elsewhere, and `--from <dir>` is where `derived` run alone reads the
// sources.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'

import { decodeWav, encodeWav } from '../src/engine/audio/wav.ts'
import { resample } from '../src/engine/pitch/resample.ts'
import { toMono } from '../tests/support/fixture-audio.ts'
import {
  type RealVoiceLabels,
  realVoiceUrl,
  realVoices,
  roomNoise,
} from '../tests/support/real-voices.ts'
import {
  type Variant,
  conditions,
  fixtureId,
  phrases,
  variants,
  voices,
} from '../tests/support/voice-fixture-set.ts'
import {
  type VoiceFixtureLabels,
  deriveCondition,
  editQuery,
  kanaOf,
  labelsOf,
  noiseSource,
  pitchLevelsOf,
  voiceSpanOf,
  voicedPitchOf,
} from '../tests/support/voice-fixtures.ts'
import {
  type AudioQuery,
  voicevoxSampleRate,
} from '../tests/support/voicevox-query.ts'

const root = join(import.meta.dirname, '..')

const { values } = parseArgs({
  options: {
    out: { type: 'string', default: join(root, 'fixtures') },
    from: { type: 'string', default: join(root, 'fixtures') },
    stage: { type: 'string', multiple: true },
  },
})
const stages = ['noise', 'real', 'voices', 'derived'] as const
const asked = values.stage ?? stages
for (const stage of asked) {
  if (!stages.some(known => known === stage)) {
    throw new Error(`--stage ${stage}: the stages are ${stages.join(', ')}.`)
  }
}
const runs = (stage: (typeof stages)[number]): boolean => asked.includes(stage)
const out = values.out
const sourcesCache = join(root, '.cache', 'fixtures', 'sources')
const voicevoxCache = join(root, '.cache', 'voicevox')
const python = join(root, '.venv', 'bin', 'python')

const writeFile = (path: string, bytes: Uint8Array | string): void => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, bytes)
}

const writeJson = (path: string, value: unknown): void =>
  writeFile(path, `${JSON.stringify(value, null, 2)}\n`)

const writeWav = (path: string, sampleRate: number, samples: Float32Array) =>
  writeFile(
    path,
    encodeWav({ sampleRate, encoding: 'pcm16', channels: [samples] }),
  )

const readMono = (path: string): Float32Array =>
  decodeWav(readFileSync(path)).channels[0] ?? new Float32Array()

const sha1Of = (bytes: Uint8Array): string =>
  createHash('sha1').update(bytes).digest('hex')

// A source file from the cache, fetched first if it is missing, and
// refused unless its SHA-1 is the pinned one.
const cachedSource = async (
  file: string,
  url: string,
  sha1: string,
): Promise<string> => {
  const path = join(sourcesCache, file)
  if (!existsSync(path) || sha1Of(readFileSync(path)) !== sha1) {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`${url}: HTTP ${response.status}`)
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (sha1Of(bytes) !== sha1) {
      throw new Error(`${url}: SHA-1 ${sha1Of(bytes)}, expected ${sha1}`)
    }
    writeFile(path, bytes)
  }
  return path
}

const voiceFixturePath = (dir: string, id: string, extension: string) =>
  join(dir, 'voices', `${id}.${extension}`)

const writeNoise = async (): Promise<void> => {
  const path = await cachedSource(
    `${roomNoise.id}.wav`,
    roomNoise.url,
    roomNoise.sha1,
  )
  const wav = decodeWav(readFileSync(path))
  const mono = resample(
    toMono(wav.channels),
    wav.sampleRate,
    voicevoxSampleRate,
  )
  writeWav(join(out, 'noise', `${roomNoise.id}.wav`), voicevoxSampleRate, mono)
  writeJson(join(out, 'noise', `${roomNoise.id}.json`), {
    ...roomNoise,
    sampleRate: voicevoxSampleRate,
    samples: mono.length,
  })
}

const ffmpeg = (args: ReadonlyArray<string>): Buffer => {
  const result = spawnSync('ffmpeg', ['-v', 'error', ...args], {
    maxBuffer: 1 << 30,
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`ffmpeg ${args.join(' ')}: ${result.stderr.toString()}`)
  }
  return result.stdout
}

const writeRealVoices = async (): Promise<void> => {
  const decoder =
    /^ffmpeg version \S+/.exec(ffmpeg(['-version']).toString())?.[0] ?? 'ffmpeg'
  for (const source of realVoices) {
    const path = await cachedSource(
      source.file,
      realVoiceUrl(source),
      source.sha1,
    )
    const sampleRate = probeSampleRate(path)
    const pcm = ffmpeg([
      '-i',
      path,
      '-f',
      's16le',
      '-acodec',
      'pcm_s16le',
      '-ac',
      '1',
      '-',
    ])
    const all = new Float32Array(pcm.length / 2)
    for (let n = 0; n < all.length; n++) {
      all[n] = pcm.readInt16LE(2 * n) / 32768
    }
    const fromSample = Math.round(source.fromSeconds * sampleRate)
    const toSample = Math.round(source.toSeconds * sampleRate)
    const clip = all.slice(fromSample, toSample)
    const { fromSeconds: _from, toSeconds: _to, ...rest } = source
    const labels: RealVoiceLabels = {
      ...rest,
      url: realVoiceUrl(source),
      itemUrl: `https://archive.org/details/${source.item}`,
      sampleRate,
      samples: clip.length,
      durationSeconds: Math.round((clip.length / sampleRate) * 1e6) / 1e6,
      fromSample,
      toSample,
      decoder,
    }
    writeWav(join(out, 'real', `${source.id}.wav`), sampleRate, clip)
    writeJson(join(out, 'real', `${source.id}.json`), labels)
  }
}

const probeSampleRate = (path: string): number => {
  const result = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'a:0',
      '-show_entries',
      'stream=sample_rate',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      path,
    ],
    { encoding: 'utf8' },
  )
  if (result.status !== 0) throw new Error(`ffprobe ${path}: ${result.stderr}`)
  return Number(result.stdout.trim())
}

type Request =
  | Readonly<{ query: string; style: number; model: string }>
  | Readonly<{
      synthesise: AudioQuery
      style: number
      model: string
      out: string
    }>

// One run of the VOICEVOX bridge over a batch of requests, answers in order.
const voicevox = (
  requests: ReadonlyArray<Request>,
): ReadonlyArray<{ query?: AudioQuery; wrote?: string }> => {
  if (!existsSync(python) || !existsSync(join(voicevoxCache, 'models'))) {
    throw new Error(
      'VOICEVOX CORE is not set up here: run `npm run fixtures:voices-setup` first.',
    )
  }
  const result = spawnSync(
    python,
    [join(root, 'scripts', 'voicevox', 'synthesise.py'), voicevoxCache],
    {
      input: requests.map(request => JSON.stringify(request)).join('\n'),
      encoding: 'utf8',
      maxBuffer: 1 << 30,
    },
  )
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`VOICEVOX: ${result.stderr}`)
  }
  return result.stdout
    .trim()
    .split('\n')
    .map(line => {
      const answer: { query?: AudioQuery; wrote?: string } = JSON.parse(line)
      return answer
    })
}

const writeVoices = (): void => {
  const scratch = mkdtempSync(join(tmpdir(), 'voice-fixtures-'))
  try {
    const jobs = phrases.flatMap(phrase =>
      voices.flatMap(voice =>
        variants.map(variant => ({ phrase, voice, variant })),
      ),
    )
    // The right accent's query per phrase and voice, and each variant's.
    const kanaJobs = phrases.flatMap(phrase =>
      voices.flatMap(voice =>
        (['right', 'fall-moved', 'fall-lost', 'mora-changed'] as const).map(
          variant => ({ phrase, voice, variant }),
        ),
      ),
    )
    const answers = voicevox(
      kanaJobs.map(({ phrase, voice, variant }) => ({
        query: kanaOf(phrase, variant),
        style: voice.styleId,
        model: voice.model,
      })),
    )
    const queryOf = new Map<string, AudioQuery>()
    kanaJobs.forEach(({ phrase, voice, variant }, k) => {
      const query = answers[k]?.query
      if (query === undefined)
        throw new Error(`VOICEVOX gave no query for ${kanaOf(phrase, variant)}`)
      queryOf.set(`${phrase.id}/${voice.id}/${variant}`, query)
    })
    const baseQuery = (phraseId: string, voiceId: string, variant: Variant) => {
      const kanaVariant =
        variant === 'fall-moved' ||
        variant === 'fall-lost' ||
        variant === 'mora-changed'
          ? variant
          : 'right'
      const query = queryOf.get(`${phraseId}/${voiceId}/${kanaVariant}`)
      if (query === undefined)
        throw new Error(`no query for ${phraseId}/${voiceId}`)
      return query
    }

    const levelsOf = new Map(
      voices.map(voice => [
        voice.id,
        pitchLevelsOf(
          phrases.map(phrase => baseQuery(phrase.id, voice.id, 'right')),
        ),
      ]),
    )
    const edited = jobs.map(({ phrase, voice, variant }) => {
      const id = fixtureId(phrase.id, voice.id, variant, 'clean')
      const levels = levelsOf.get(voice.id)
      if (levels === undefined) throw new Error(`no levels for ${voice.id}`)
      return {
        phrase,
        voice,
        variant,
        id,
        query: editQuery(
          baseQuery(phrase.id, voice.id, variant),
          variant,
          id,
          levels,
        ),
        wav: join(scratch, `${id.replaceAll('/', '_')}.wav`),
      }
    })
    voicevox(
      edited.map(({ voice, query, wav }) => ({
        synthesise: query,
        style: voice.styleId,
        model: voice.model,
        out: wav,
      })),
    )
    for (const { phrase, voice, variant, id, query, wav } of edited) {
      const samples = readMono(wav)
      const labels = labelsOf({
        phrase,
        voice,
        variant,
        query,
        rightQuery: baseQuery(phrase.id, voice.id, 'right'),
        samples: samples.length,
      })
      writeWav(voiceFixturePath(out, id, 'wav'), voicevoxSampleRate, samples)
      writeJson(voiceFixturePath(out, id, 'json'), labels)
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

// The room and phone versions of every clean fixture, and each voice's
// measured span, from the clean fixtures and the noise under `from`.
const writeDerived = (from: string): void => {
  const noise = readMono(join(from, `${noiseSource}.wav`))
  const spans = voices.map(voice => {
    const pitches: Array<number> = []
    for (const phrase of phrases) {
      for (const variant of variants) {
        const id = fixtureId(phrase.id, voice.id, variant, 'clean')
        const clean = readMono(voiceFixturePath(from, id, 'wav'))
        const labels: VoiceFixtureLabels = JSON.parse(
          readFileSync(voiceFixturePath(from, id, 'json'), 'utf8'),
        )
        if (variant === 'right') {
          pitches.push(...voicedPitchOf(clean, labels))
        }
        for (const condition of conditions) {
          if (condition === 'clean') continue
          const derived = deriveCondition(clean, labels, condition, noise)
          const peak = derived.samples.reduce(
            (max, s) => Math.max(max, Math.abs(s)),
            0,
          )
          if (peak >= 1) {
            throw new Error(`${derived.labels.id} clips: its peak is ${peak}.`)
          }
          writeWav(
            voiceFixturePath(out, derived.labels.id, 'wav'),
            labels.sampleRate,
            derived.samples,
          )
          writeJson(
            voiceFixturePath(out, derived.labels.id, 'json'),
            derived.labels,
          )
        }
      }
    }
    return {
      ...voiceSpanOf(voice, pitches),
      credit: voice.credit,
      termsUrl: voice.termsUrl,
    }
  })
  writeJson(join(out, 'voices', 'voices.json'), spans)
}

if (runs('noise')) await writeNoise()
if (runs('real')) await writeRealVoices()
if (runs('voices')) writeVoices()
if (runs('derived')) writeDerived(asked.length === 1 ? values.from : out)
