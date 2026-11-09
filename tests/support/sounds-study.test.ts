import { describe, expect, it } from 'vitest'

import { whisperLogMel } from './sound-models.ts'
import type { SoundFeatures } from './sound-models.ts'
import { cosineDtwDistance, soundsPart } from './sounds-study.ts'

// Unit frames turning through `angles`, one a frame, in two dims.
const turning = (angles: ReadonlyArray<number>): SoundFeatures => ({
  frameHz: 50,
  dims: 2,
  data: Float32Array.from(
    angles.flatMap(angle => [Math.cos(angle), Math.sin(angle)]),
  ),
})

const sweep = (frames: number) =>
  Array.from({ length: frames }, (_, i) => (Math.PI / 2) * (i / (frames - 1)))

describe('cosineDtwDistance', () => {
  it('is 0 for a recording against itself', () => {
    const recording = turning(sweep(40))
    expect(cosineDtwDistance(recording, recording)).toBeCloseTo(0, 6)
  })

  it('is near 0 for the same sounds said at half the speed', () => {
    expect(
      cosineDtwDistance(turning(sweep(40)), turning(sweep(80))),
    ).toBeLessThan(0.001)
  })

  it('is 1 for frames at right angles, and 2 for opposite ones', () => {
    const along = turning(Array.from({ length: 20 }, () => 0))
    const across = turning(Array.from({ length: 20 }, () => Math.PI / 2))
    const against = turning(Array.from({ length: 20 }, () => Math.PI))
    expect(cosineDtwDistance(along, across)).toBeCloseTo(1, 6)
    expect(cosineDtwDistance(along, against)).toBeCloseTo(2, 6)
  })

  it('rises with the share of frames that differ', () => {
    const native = turning(Array.from({ length: 40 }, () => 0))
    const changed = (frames: number) =>
      turning(
        Array.from({ length: 40 }, (_, i) =>
          i >= 20 && i < 20 + frames ? Math.PI / 2 : 0,
        ),
      )
    expect(cosineDtwDistance(native, changed(4))).toBeLessThan(
      cosineDtwDistance(native, changed(12)),
    )
  })

  it('answers NaN for under two frames', () => {
    expect(cosineDtwDistance(turning([0]), turning(sweep(10)))).toBeNaN()
  })
})

describe('soundsPart', () => {
  const scale = { top: 0.1, zero: 0.5 }
  it('is 1 at the top, 0 at other words, straight between, and clamped', () => {
    expect(soundsPart(scale, 0.1)).toBe(1)
    expect(soundsPart(scale, 0.3)).toBeCloseTo(0.5, 9)
    expect(soundsPart(scale, 0.5)).toBe(0)
    expect(soundsPart(scale, 0.05)).toBe(1)
    expect(soundsPart(scale, 0.9)).toBe(0)
  })
})

describe('whisperLogMel', () => {
  it('is 80 bands of 3000 frames, silence at its floor, 8 in log10 under the top', () => {
    const tone = Float32Array.from(
      { length: 16_000 },
      (_, n) => 0.5 * Math.sin((2 * Math.PI * 1000 * n) / 16_000),
    )
    const mel = whisperLogMel(tone)
    expect(mel.length).toBe(80 * 3000)
    const top = mel.reduce((a, b) => Math.max(a, b), Number.NEGATIVE_INFINITY)
    // Frame 2000 is 20 s in, in the padding's silence.
    for (let band = 0; band < 80; band++) {
      expect(mel[band * 3000 + 2000]).toBeCloseTo(top - 2, 5)
    }
  })

  it('puts a 1 kHz tone in the band whose centre is nearest 1 kHz', () => {
    const tone = Float32Array.from(
      { length: 16_000 },
      (_, n) => 0.5 * Math.sin((2 * Math.PI * 1000 * n) / 16_000),
    )
    const mel = whisperLogMel(tone)
    let loudest = 0
    for (let band = 1; band < 80; band++) {
      if ((mel[band * 3000 + 50] ?? 0) > (mel[loudest * 3000 + 50] ?? 0))
        loudest = band
    }
    // The Slaney scale is linear to 1 kHz, 15 mel, over 80 bands to
    // 8 kHz (45.25 mel): band b is centred at (b + 1) x 45.25 / 81 mel.
    expect(loudest).toBe(Math.round((15 * 81) / 45.25) - 1)
  })
})
