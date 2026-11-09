import { describe, expect, it } from 'vitest'

import { type SwiftF0Inference, frameCount, swiftF0Hop } from './swift-f0'
import { analyseTake } from './take'

// A stand-in for the model: a frame is voiced at 150 Hz, confidence 0.9,
// when its hop carries a tone louder than `voicedAbove`; otherwise it is
// unvoiced at confidence 0.2. It records the peak of what it was given.
const toneDetector = (
  voicedAbove: number,
): SwiftF0Inference & { peaks: Array<number> } => {
  const peaks: Array<number> = []
  const infer: SwiftF0Inference = async samples => {
    peaks.push(samples.reduce((peak, x) => Math.max(peak, Math.abs(x)), 0))
    const frames = frameCount(samples.length)
    const rms = Array.from({ length: frames }, (_, frame) => {
      const hop = samples.subarray(frame * swiftF0Hop, (frame + 1) * swiftF0Hop)
      return Math.sqrt(hop.reduce((sum, x) => sum + x * x, 0) / hop.length)
    })
    return {
      pitchHz: rms.map(level => (level > voicedAbove ? 150 : 400)),
      confidence: rms.map(level => (level > voicedAbove ? 0.9 : 0.2)),
    }
  }
  return Object.assign(infer, { peaks })
}

const rate = 16_000

// `pieces` laid end to end: a tone at `amplitude` for `seconds`, or noise.
const take = (
  pieces: ReadonlyArray<
    Readonly<{ seconds: number; tone?: number; noise?: number }>
  >,
): Float32Array => {
  let seed = 7
  const random = (): number => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648
    return seed / 2_147_483_648 - 0.5
  }
  return Float32Array.from(
    pieces.flatMap(({ seconds, tone = 0, noise = 0 }) =>
      Array.from(
        { length: Math.round(seconds * rate) },
        (_, i) =>
          tone * Math.sin((2 * Math.PI * 150 * i) / rate) + noise * random(),
      ),
    ),
  )
}

const dbOf = (amplitude: number): number => 20 * Math.log10(amplitude)

describe('analyseTake', () => {
  it('tracks a clear take unscaled, gating frames below confidence 0.5 to 0', async () => {
    const detector = toneDetector(0.01)
    const analysis = await analyseTake(
      take([{ seconds: 0.5 }, { seconds: 1, tone: 0.5 }, { seconds: 0.5 }]),
      detector,
    )
    expect(analysis._tag).toBe('Tracked')
    if (analysis._tag !== 'Tracked') {
      return
    }
    expect(analysis.gainDb).toBe(0)
    expect(analysis.peakDb).toBeCloseTo(dbOf(0.5), 1)
    expect(detector.peaks[0]).toBeCloseTo(0.5, 2)
    const { curve } = analysis
    expect(curve.frameHz).toBe(62.5)
    expect(curve.f0Hz.length).toBe(125)
    // The tone fills hops 32 to 93 whole (0.5 s is 31.25 hops).
    expect(curve.f0Hz[20]).toBe(0)
    expect(curve.f0Hz[60]).toBe(150)
    expect(curve.f0Hz[110]).toBe(0)
    expect(curve.confidence[20]).toBe(0)
    expect(curve.confidence[110]).toBeCloseTo(0, 6)
  })

  it('starts the curve at the first run of three voiced frames, past a stray one', async () => {
    const analysis = await analyseTake(
      take([
        { seconds: 0.3 },
        { seconds: 0.016, tone: 0.5 },
        { seconds: 0.2 },
        { seconds: 1, tone: 0.5 },
        { seconds: 0.5 },
      ]),
      toneDetector(0.01),
    )
    expect(analysis._tag).toBe('Tracked')
    if (analysis._tag === 'Tracked') {
      const { f0Hz, onsetFrame } = analysis.curve
      expect(f0Hz.slice(18, 20).some(hz => hz > 0)).toBe(true)
      expect(onsetFrame).toBeGreaterThan(30)
      expect(f0Hz[onsetFrame]).toBe(150)
      expect(f0Hz[onsetFrame - 1]).toBe(0)
    }
  })

  it('scales a take peaking below -35 dBFS to -20 dBFS before tracking, and reports its level unscaled', async () => {
    const detector = toneDetector(0.005)
    const analysis = await analyseTake(
      take([{ seconds: 0.5 }, { seconds: 1, tone: 0.01 }, { seconds: 0.5 }]),
      detector,
    )
    expect(detector.peaks[0]).toBeCloseTo(0.1, 2)
    expect(analysis._tag).toBe('Tracked')
    if (analysis._tag === 'Tracked') {
      expect(analysis.peakDb).toBeCloseTo(-40, 1)
      expect(analysis.gainDb).toBeCloseTo(20, 1)
      expect(analysis.curve.levelDb[60]).toBeCloseTo(
        dbOf(0.01 * Math.SQRT1_2),
        0,
      )
    }
  })

  it('gives at most 30 dB of gain', async () => {
    const detector = toneDetector(0.5)
    await analyseTake(
      take([{ seconds: 1, tone: 0.001 }, { seconds: 0.2 }]),
      detector,
    )
    expect(dbOf(detector.peaks[0] ?? 0)).toBeCloseTo(-30, 1)
  })

  it('names a take too quiet when it has little voice and peaks below -50 dBFS', async () => {
    expect(
      await analyseTake(
        take([{ seconds: 2, noise: 0.002 }]),
        toneDetector(0.1),
      ),
    ).toStrictEqual({ _tag: 'TooQuiet', peakDb: expect.any(Number) })
    expect(
      await analyseTake(new Float32Array(rate), toneDetector(0.01)),
    ).toStrictEqual({ _tag: 'TooQuiet', peakDb: -140 })
  })

  it('names a take too noisy when it is loud with little voice', async () => {
    const analysis = await analyseTake(
      take([{ seconds: 2, noise: 0.4 }]),
      toneDetector(10),
    )
    expect(analysis._tag).toBe('TooNoisy')
  })

  it('names a take too noisy when the room is nearly as loud as the voice', async () => {
    const analysis = await analyseTake(
      take([
        { seconds: 0.5, noise: 0.3 },
        { seconds: 1, tone: 0.2, noise: 0.3 },
        { seconds: 0.5, noise: 0.3 },
      ]),
      // Voiced only where the tone adds to the noise.
      toneDetector(0.1),
    )
    expect(analysis._tag).toBe('TooNoisy')
  })

  it('tracks a take voiced from end to end, with no room sound to judge', async () => {
    const analysis = await analyseTake(
      take([{ seconds: 1, tone: 0.3 }]),
      toneDetector(0.01),
    )
    expect(analysis._tag).toBe('Tracked')
  })
})
