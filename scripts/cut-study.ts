// Writes docs/cut-study.md: how the clip Worker's own code
// (src/engine/cut/clip.ts) cuts the LibriVox CC0 clips in fixtures/real/
// into lines, on the real Silero VAD and SwiftF0 models, and what each
// line's native curve came to. `npm run cut:study`; `--out <file>` writes
// elsewhere, and `--time` also prints how long each clip took to cut.
// Run with `node --import ./scripts/source-imports.ts`, as the npm script
// does.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import { decodeWav } from '../src/engine/audio/wav.ts'
import { analyseClip } from '../src/engine/cut/clip.ts'
import { cutRules } from '../src/engine/cut/lines.ts'
import { resample } from '../src/engine/pitch/resample.ts'
import { loadSileroModel, withSilero } from '../tests/support/silero.ts'
import { loadSwiftF0Model, withSwiftF0 } from '../tests/support/swift-f0.ts'

const root = join(import.meta.dirname, '..')
const { values } = parseArgs({
  options: {
    out: { type: 'string', default: join(root, 'docs', 'cut-study.md') },
    time: { type: 'boolean', default: false },
  },
})

export const studyClips = ['romandourou', 'gongitsune', 'good-bye'] as const

const rate = 16_000

const mono = (path: string): Float32Array => {
  const wav = decodeWav(readFileSync(path))
  const [first, ...others] = wav.channels
  const mixed = Float32Array.from(
    first ?? [],
    (sample, i) =>
      others.reduce((sum, channel) => sum + (channel[i] ?? 0), sample) /
      wav.channels.length,
  )
  return resample(mixed, wav.sampleRate, rate)
}

const two = (value: number): string => value.toFixed(2)

const quantile = (sorted: ReadonlyArray<number>, q: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0

const [speechModel, pitchModel] = await Promise.all([
  loadSileroModel(),
  loadSwiftF0Model(),
])

const studied = await withSilero(speechModel, speech =>
  withSwiftF0(pitchModel, async pitch => {
    const results = []
    for (const clip of studyClips) {
      const samples = mono(join(root, 'fixtures', 'real', `${clip}.wav`))
      const started = process.hrtime.bigint()
      const lines = await analyseClip(samples, { speech, pitch }, () => {})
      const milliseconds = Number(process.hrtime.bigint() - started) / 1e6
      results.push({
        clip,
        seconds: samples.length / rate,
        lines,
        milliseconds,
      })
    }
    return results
  }),
)

const rows = studied.map(({ clip, seconds, lines }) => {
  const lengths = lines.map(({ from, to }) => (to - from) / rate)
  const sorted = [...lengths].sort((a, b) => a - b)
  const inRange = lengths.filter(length => length >= 1 && length <= 4.5)
  const tracked = lines.filter(line => line.curve._tag === 'Tracked')
  return `| ${clip} | ${seconds.toFixed(1)} | ${lines.length} | ${two(sorted[0] ?? 0)} | ${two(quantile(sorted, 0.5))} | ${two(sorted.at(-1) ?? 0)} | ${inRange.length} | ${tracked.length} |`
})

const details = studied.flatMap(({ clip, lines }) => [
  '',
  `### ${clip}`,
  '',
  '| Line | From, s | To, s | Length, s | Native curve | Voiced frames |',
  '| - | - | - | - | - | - |',
  ...lines.map((line, k) => {
    const voiced =
      line.curve._tag === 'Tracked'
        ? String(line.curve.curve.f0Hz.filter(hz => hz > 0).length)
        : '-'
    return `| ${k + 1} | ${two(line.from / rate)} | ${two(line.to / rate)} | ${two((line.to - line.from) / rate)} | ${line.curve._tag} | ${voiced} |`
  }),
])

const document = [
  '# Cutting a clip into lines: the study',
  '',
  "Written by `npm run cut:study` from the LibriVox CC0 clips in `fixtures/real/` (one reader, a quiet room), through the clip Worker's own code (`src/engine/cut/clip.ts`) on the real Silero VAD and SwiftF0 models under Node.",
  'Do not edit it by hand: `tests/scripts/cut-study.test.ts` remakes it and fails on any difference.',
  'How long a cut takes is not here, since it changes from run to run; `docs/uploads.md` gives it.',
  '',
  `The rules (\`cutRules\` in \`src/engine/cut/lines.ts\`): speech from a probability of ${cutRules.threshold}, held until under ${cutRules.negativeThreshold} for ${cutRules.pauseSeconds * 1000} ms; speech under ${cutRules.shortestSpeechSeconds * 1000} ms left out; a line over ${cutRules.longestLineSeconds} s cut at its longest inner silence; a line under ${cutRules.shortestLineSeconds} s joined to its nearer neighbour across a pause under ${cutRules.joinPauseSeconds * 1000} ms; ${cutRules.leadSeconds * 1000} ms kept before each line and ${cutRules.tailSeconds * 1000} ms after, or half the pause to its neighbour.`,
  `A line's length below includes that lead and tail, so "1 to 4.5 s" counts the lines of about 1 to 4 s of speech.`,
  '',
  '| Clip | Seconds | Lines | Shortest, s | Median, s | Longest, s | 1 to 4.5 s | With a native curve |',
  '| - | - | - | - | - | - | - | - |',
  ...rows,
  '',
  '## Each line',
  ...details,
  '',
].join('\n')

writeFileSync(values.out, document)

if (values.time) {
  studied.forEach(({ clip, seconds, milliseconds }) => {
    console.log(
      `${clip}: ${seconds.toFixed(1)} s cut in ${(milliseconds / 1000).toFixed(2)} s, ${(seconds / (milliseconds / 1000)).toFixed(1)}x real time`,
    )
  })
}
