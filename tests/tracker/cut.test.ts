import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, test } from 'vitest'

import { decodeWav } from '../../src/engine/audio/wav.ts'
import { analyseClip } from '../../src/engine/cut/clip.ts'
import { resample } from '../../src/engine/pitch/resample.ts'
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
