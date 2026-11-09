// Writes docs/cut-study.md: how the clip Worker's own code
// (src/engine/cut/clip.ts) cuts the LibriVox CC0 clips in fixtures/real/
// into lines, on the real Silero VAD and SwiftF0 models, what each
// line's native curve came to and its quality (src/engine/cut/quality.ts),
// and how the quality marks fall when the clips are heard through the
// classroom noise or over the synthetic music bed
// (tests/support/music-bed.ts); and src/app/dev/cutStudyLines.json, the
// first clip's waveform and lines, clean and over the music bed, for the
// dev library's demos of a clip. `npm run
// cut:study`; `--out <file>` and `--lines-out <file>` write elsewhere, and
// `--time` also prints how long each clip took to cut.
// Run with `node --import ./scripts/source-imports.ts`, as the npm script
// does.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import { waveformPeaks } from '../src/engine/audio/peaks.ts'
import { decodeWav } from '../src/engine/audio/wav.ts'
import { type ClipLine, analyseClip } from '../src/engine/cut/clip.ts'
import { cutRules } from '../src/engine/cut/lines.ts'
import { lineMarks, qualityRules } from '../src/engine/cut/quality.ts'
import { resample } from '../src/engine/pitch/resample.ts'
import { mixUnder, musicBed, rmsWhere } from '../tests/support/music-bed.ts'
import { loadSileroModel, withSilero } from '../tests/support/silero.ts'
import { loadSwiftF0Model, withSwiftF0 } from '../tests/support/swift-f0.ts'

const root = join(import.meta.dirname, '..')
const { values } = parseArgs({
  options: {
    out: { type: 'string', default: join(root, 'docs', 'cut-study.md') },
    'lines-out': {
      type: 'string',
      default: join(root, 'src', 'app', 'dev', 'cutStudyLines.json'),
    },
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

// The conditions the quality marks are measured in: the classroom noise
// (fixtures/noise/) at 8 dB under the speech, the most that still leaves
// the readings' lines a curve, and the music bed at 15, 20 and 25 dB
// under it.
const noiseSnrDb = 8
const musicUnderDb = [15, 20, 25] as const

const noise = mono(join(root, 'fixtures', 'noise', 'classroom.wav'))
const noiseRms = rmsWhere(noise, () => true)

// The speech's RMS: over the clean clip's lines.
const speechRmsOf = (
  samples: Float32Array,
  lines: ReadonlyArray<ClipLine>,
): number =>
  rmsWhere(samples, n => lines.some(line => n >= line.from && n < line.to))

const underNoise = (samples: Float32Array, speechRms: number) =>
  mixUnder(
    samples,
    Float32Array.from(
      samples,
      (_, n) =>
        ((noise[n % noise.length] ?? 0) *
          speechRms *
          10 ** (-noiseSnrDb / 20)) /
        noiseRms,
    ),
  )

const overMusic = (
  samples: Float32Array,
  speechRms: number,
  underDb: number,
  clip: string,
) =>
  mixUnder(
    samples,
    musicBed(samples.length / rate, speechRms * 10 ** (-underDb / 20), clip),
  )

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
      const speechRms = speechRmsOf(samples, lines)
      const cutOf = (heard: Float32Array) =>
        analyseClip(heard, { speech, pitch }, () => {})
      const conditions = [
        {
          name: `Classroom noise, ${noiseSnrDb} dB under`,
          lines: await cutOf(underNoise(samples, speechRms)),
        },
      ]
      for (const underDb of musicUnderDb) {
        conditions.push({
          name: `Music bed, ${underDb} dB under`,
          lines: await cutOf(overMusic(samples, speechRms, underDb, clip)),
        })
      }
      results.push({
        clip,
        samples,
        seconds: samples.length / rate,
        lines,
        conditions,
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
  '| Line | From, s | To, s | Length, s | Native curve | Voiced frames | Confident speech | Pitched pauses |',
  '| - | - | - | - | - | - | - | - |',
  ...lines.map((line, k) => {
    const tracked = line.curve._tag === 'Tracked' ? line.curve : null
    const voiced =
      tracked === null
        ? '-'
        : String(tracked.curve.f0Hz.filter(hz => hz > 0).length)
    const confident =
      tracked === null ? '-' : two(tracked.quality.confidentShare)
    const pitched =
      tracked === null
        ? '-'
        : `${two(tracked.quality.pausePitchedShare)} of ${tracked.quality.pauseFrames}`
    return `| ${k + 1} | ${two(line.from / rate)} | ${two(line.to / rate)} | ${two((line.to - line.from) / rate)} | ${line.curve._tag} | ${voiced} | ${confident} | ${pitched} |`
  }),
])

const range = (values: ReadonlyArray<number>): string => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length === 0
    ? '-'
    : `${two(sorted[0] ?? 0)} to ${two(sorted.at(-1) ?? 0)}`
}

const markRow = (
  clip: string,
  condition: string,
  lines: ReadonlyArray<ClipLine>,
): string => {
  const qualities = lines.flatMap(line =>
    line.curve._tag === 'Tracked' ? [line.curve.quality] : [],
  )
  const marks = qualities.map(quality => lineMarks(quality))
  return `| ${clip} | ${condition} | ${lines.length} | ${qualities.length} | ${range(qualities.map(quality => quality.confidentShare))} | ${range(qualities.map(quality => quality.pausePitchedShare))} | ${marks.filter(mark => mark.lowConfidence).length} | ${marks.filter(mark => mark.likelyMusic).length} |`
}

const markRows = studied.flatMap(({ clip, lines, conditions }) => [
  markRow(clip, 'Clean', lines),
  ...conditions.map(condition =>
    markRow(clip, condition.name, condition.lines),
  ),
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
  '## The quality marks',
  '',
  `Each tracked line's quality (\`lineQuality\` in \`src/engine/cut/quality.ts\`) pairs its curve with Silero's windows over it: the share of its speech (a window at ${qualityRules.speechThreshold} or over) with a confident pitch, and the share of its pauses (under ${qualityRules.pauseThreshold}, ${qualityRules.pauseMarginSeconds * 1000} ms or more from speech) that still have one.`,
  `A line is marked for low pitch confidence under ${qualityRules.lowConfidentShare} confident speech, with ${qualityRules.fewestSpeechFrames} speech frames or more, and as likely music over ${qualityRules.musicPausePitchedShare} pitched pauses, with ${qualityRules.fewestPauseFrames} pause frames or more.`,
  `Below, each clip clean, under the classroom noise (\`fixtures/noise/\`) ${noiseSnrDb} dB below its speech, and over the synthetic music bed (\`tests/support/music-bed.ts\`, held chords and a melody, not real music) ${musicUnderDb.join(', ')} dB below it; a line with no curve (too noisy, mostly) has no quality.`,
  '',
  '| Clip | Heard | Lines | With a curve | Confident speech | Pitched pauses | Low confidence | Likely music |',
  '| - | - | - | - | - | - | - | - |',
  ...markRows,
  '',
  '## Each line',
  ...details,
  '',
].join('\n')

writeFileSync(values.out, document)

const four = (value: number): number => Number(value.toFixed(4))

const jsonLine = (line: ClipLine) => ({
  from: Number((line.from / rate).toFixed(3)),
  to: Number((line.to / rate).toFixed(3)),
  native: line.curve._tag,
  ...(line.curve._tag === 'Tracked'
    ? {
        quality: {
          speechFrames: line.curve.quality.speechFrames,
          confidentShare: four(line.curve.quality.confidentShare),
          pauseFrames: line.curve.quality.pauseFrames,
          pausePitchedShare: four(line.curve.quality.pausePitchedShare),
        },
      }
    : {}),
})

const [first] = studied
writeFileSync(
  values['lines-out'],
  `${JSON.stringify(
    {
      clip: first?.clip,
      seconds: Number((first?.seconds ?? 0).toFixed(3)),
      // The waveform the editor draws (src/engine/audio/peaks.ts), as
      // base64.
      peaks: Buffer.from(
        waveformPeaks(first?.samples ?? new Float32Array(0), rate),
      ).toString('base64'),
      lines: (first?.lines ?? []).map(jsonLine),
      // The same clip over the music bed at 15 dB under its speech.
      musicLines: (first?.conditions[1]?.lines ?? []).map(jsonLine),
    },
    null,
    1,
  )}\n`,
)

if (values.time) {
  studied.forEach(({ clip, seconds, milliseconds }) => {
    console.log(
      `${clip}: ${seconds.toFixed(1)} s cut in ${(milliseconds / 1000).toFixed(2)} s, ${(seconds / (milliseconds / 1000)).toFixed(1)}x real time`,
    )
  })
}
