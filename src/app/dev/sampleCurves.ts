import { Array, Option, Schema } from 'effect'

import high from '../../../fixtures/synthetic/high.json?raw'
import low from '../../../fixtures/synthetic/low.json?raw'
import middle from '../../../fixtures/synthetic/middle.json?raw'
import type { TakeCurve } from '../take/take'

// Demo curves for the library, never typed in: each synthetic voice's
// labels, written by `npm run fixtures:synthetic` from its seed, read as
// the curve a perfect tracker would give for it.

const Labels = Schema.Struct({
  frameHz: Schema.Finite,
  f0Hz: Schema.Array(Schema.NullOr(Schema.Finite)),
})

const sampleVoices = ['low', 'middle', 'high'] as const
export type SampleVoice = (typeof sampleVoices)[number]

const labelText: Readonly<Record<SampleVoice, string>> = { low, middle, high }

const curveOf = (text: string): TakeCurve => {
  const labels = Schema.decodeSync(Schema.fromJsonString(Labels))(text)
  const f0Hz = Array.map(labels.f0Hz, hz => hz ?? 0)
  return {
    frameHz: labels.frameHz,
    f0Hz,
    confidence: Array.map(f0Hz, hz => (hz > 0 ? 0.95 : 0.05)),
    levelDb: Array.map(f0Hz, hz => (hz > 0 ? -18 : -80)),
    onsetFrame: Option.getOrElse(
      Array.findFirstIndex(f0Hz, hz => hz > 0),
      () => 0,
    ),
  }
}

export const sampleCurves: Readonly<Record<SampleVoice, TakeCurve>> = {
  low: curveOf(labelText.low),
  middle: curveOf(labelText.middle),
  high: curveOf(labelText.high),
}
