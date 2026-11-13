import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, test } from 'vitest'

import { decodeWav } from '../../src/engine/audio/wav.ts'
import { analyseClip, trackSpans } from '../../src/engine/cut/clip.ts'
import { lineMarks } from '../../src/engine/cut/quality.ts'
import { resample } from '../../src/engine/pitch/resample.ts'
import { mixUnder, musicBed, rmsWhere } from '../support/music-bed.ts'
import { root } from '../support/run.ts'
import { loadSileroModel, withSilero } from '../support/silero.ts'
import { loadSwiftF0Model, withSwiftF0 } from '../support/swift-f0.ts'

// The clip Worker's own code (src/engine/cut/clip.ts) on the real Silero
// VAD and SwiftF0 models under Node: a clip's lines and their native
// curves. docs/cut-study.md has the CC0 clips' lines line by line.

let speechModel: Uint8Array<ArrayBuffer> = new Uint8Array(0)
let pitchModel: Uint8Array<ArrayBuffer> = new Uint8Array(0)

beforeAll(async () => {
  ;[speechModel, pitchModel] = await Promise.all([
    loadSileroModel(),
    loadSwiftF0Model(),
  ])
})

const rate = 16_000

const read = (path: string): Float32Array => {
  const wav = decodeWav(readFileSync(join(root, path)))
  return resample(wav.channels[0] ?? new Float32Array(0), wav.sampleRate, rate)
}

const cut = (samples: Float32Array) =>
  withSilero(speechModel, speech =>
    withSwiftF0(pitchModel, pitch =>
      analyseClip(samples, { speech, pitch }, () => {}),
    ),
  )

describe('cutting a clip on the real models', () => {
  test('silence has no line', async () => {
    expect(await cut(new Float32Array(5 * rate))).toEqual([])
  })

  test('one phrase between silences is one line holding all its voice', async () => {
    const path = 'fixtures/voices/ame-ga-suki/meimei-himari/right'
    const phrase = read(`${path}.wav`)
    const labels: { speechStartSample: number; speechEndSample: number } =
      JSON.parse(readFileSync(join(root, `${path}.json`), 'utf8'))
    // The labels count samples at the fixture's own 24 kHz.
    const speechFrom = 2 * rate + (labels.speechStartSample * 2) / 3
    const speechTo = 2 * rate + (labels.speechEndSample * 2) / 3
    const clip = new Float32Array(phrase.length + 4 * rate)
    clip.set(phrase, 2 * rate)
    const lines = await cut(clip)
    expect(lines).toHaveLength(1)
    const [line] = lines
    expect(line?.curve._tag).toBe('Tracked')
    expect(line?.from).toBeLessThanOrEqual(speechFrom)
    expect(line?.to).toBeGreaterThanOrEqual(speechTo)
  })

  test.each(['romandourou', 'gongitsune', 'good-bye'])(
    'the CC0 clip %s is cut into lines of about 1 to 4 s, each with a native curve',
    async clip => {
      const samples = read(`fixtures/real/${clip}.wav`)
      const lines = await cut(samples)
      const seconds = samples.length / rate
      // About one line every 3 s, as the report found (22 in 60 s).
      expect(lines.length).toBeGreaterThanOrEqual(seconds / 6)
      expect(lines.length).toBeLessThanOrEqual(seconds / 1.5)
      lines.forEach((line, k) => {
        const length = (line.to - line.from) / rate
        expect(length).toBeGreaterThanOrEqual(0.8)
        expect(length).toBeLessThanOrEqual(4.5)
        expect(line.curve._tag).toBe('Tracked')
        expect(line.from).toBeGreaterThanOrEqual(lines[k - 1]?.to ?? 0)
      })
    },
  )
})

describe('a line’s quality and tracking it again, on the real models', () => {
  const clip = 'fixtures/real/gongitsune.wav'

  test('no line of a CC0 reading in a quiet room is marked', async () => {
    const lines = await cut(read(clip))
    lines.forEach(line => {
      expect(line.curve._tag).toBe('Tracked')
      if (line.curve._tag === 'Tracked') {
        expect(lineMarks(line.curve.quality)).toStrictEqual({
          lowConfidence: false,
          likelyMusic: false,
        })
      }
    })
  })

  test('the same reading over the music bed has most lines marked as music', async () => {
    const samples = read(clip)
    const lines = await cut(samples)
    const speechRms = rmsWhere(samples, n =>
      lines.some(line => n >= line.from && n < line.to),
    )
    const overMusic = mixUnder(
      samples,
      musicBed(
        samples.length / rate,
        speechRms * 10 ** (-15 / 20),
        'gongitsune',
      ),
    )
    const marked = (await cut(overMusic)).flatMap(line =>
      line.curve._tag === 'Tracked' && lineMarks(line.curve.quality).likelyMusic
        ? [line]
        : [],
    )
    expect(marked.length).toBeGreaterThanOrEqual(3)
  })

  test('a cut line’s own span tracked again gives the same curve and features', async () => {
    const samples = read(clip)
    const lines = await cut(samples)
    const picked = [lines[0], lines[4]].flatMap(line =>
      line === undefined ? [] : [line],
    )
    const again = await withSilero(speechModel, speech =>
      withSwiftF0(pitchModel, pitch =>
        trackSpans(samples, picked, { speech, pitch }),
      ),
    )
    expect(again).toHaveLength(2)
    again.forEach((line, k) => {
      const cutLine = picked[k]
      expect(line.from).toBe(cutLine?.from)
      expect(line.to).toBe(cutLine?.to)
      if (line.curve._tag !== 'Tracked' || cutLine?.curve._tag !== 'Tracked') {
        throw new Error('Both should be tracked.')
      }
      expect(line.curve.curve.f0Hz).toStrictEqual(cutLine.curve.curve.f0Hz)
      expect(line.curve.features).toStrictEqual(cutLine.curve.features)
      expect(lineMarks(line.curve.quality)).toStrictEqual(
        lineMarks(cutLine.curve.quality),
      )
      expect(
        Math.abs(
          line.curve.quality.confidentShare -
            cutLine.curve.quality.confidentShare,
        ),
      ).toBeLessThan(0.05)
    })
  })

  test('a span moved or split is tracked from its own audio', async () => {
    const samples = read(clip)
    const [first] = await cut(samples)
    if (first === undefined) {
      throw new Error('The clip has a first line.')
    }
    const middle = Math.round((first.from + first.to) / 2)
    const halves = await withSilero(speechModel, speech =>
      withSwiftF0(pitchModel, pitch =>
        trackSpans(
          samples,
          [
            { from: first.from, to: middle },
            { from: middle, to: first.to },
          ],
          { speech, pitch },
        ),
      ),
    )
    expect(halves.map(({ from, to }) => [from, to])).toStrictEqual([
      [first.from, middle],
      [middle, first.to],
    ])
    halves.forEach(half => {
      if (half.curve._tag === 'Tracked') {
        expect(half.curve.curve.f0Hz.length).toBeLessThan(
          (first.to - first.from) / 256,
        )
      }
    })
  })
})
