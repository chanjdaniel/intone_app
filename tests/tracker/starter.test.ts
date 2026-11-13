import { Schema } from 'effect'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, test } from 'vitest'

import { decodeWav } from '../../src/engine/audio/wav.ts'
import { resample } from '../../src/engine/pitch/resample.ts'
import { analyseTake } from '../../src/engine/pitch/take.ts'
import { StarterPack } from '../../src/services/starter-records.ts'
import { root } from '../support/run.ts'
import { loadSwiftF0Model, withSwiftF0 } from '../support/swift-f0.ts'

// Every starter line can be copied: its file, tracked by the app's own
// tracker on the real SwiftF0 model as the practice screen tracks it,
// gives a native curve, neither too quiet nor too noisy, with its voice
// over most of its morae.

const pack = Schema.decodeUnknownSync(StarterPack)(
  JSON.parse(
    readFileSync(join(root, 'starter', 'pack', 'levels.json'), 'utf8'),
  ),
)
const lines = pack.levels.flatMap(level => level.lines)

let model: Uint8Array<ArrayBuffer> = new Uint8Array(0)

beforeAll(async () => {
  model = await loadSwiftF0Model()
})

describe('the starter set', () => {
  test.each(lines.map(line => [line.id, line] as const))(
    '%s gives a native curve',
    async (_, line) => {
      const wav = decodeWav(
        readFileSync(join(root, 'starter', 'pack', line.audio)),
      )
      const samples = wav.channels[0] ?? new Float32Array(0)
      const analysis = await withSwiftF0(model, infer =>
        analyseTake(resample(samples, wav.sampleRate, 16_000), infer),
      )
      expect(analysis._tag).toBe('Tracked')
      if (analysis._tag !== 'Tracked') return
      const voiced = analysis.curve.f0Hz.filter(hz => hz > 0).length
      // The quickest lines, Lingua Libre's phrases, are voiced for 59 ms
      // a mora at the least (駅に着きます, whose き, つ and す are
      // devoiced), measured 2026-11-13; a curve under 40 ms a mora has
      // lost its voice.
      expect(voiced / analysis.curve.frameHz).toBeGreaterThan(
        0.04 * line.morae.length,
      )
    },
  )
})
