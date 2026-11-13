import { describe, expect, it } from 'vitest'

import { type LiveFrames, createLiveTracker } from './live'
import { type SwiftF0Inference, frameCount, swiftF0Hop } from './swift-f0'
import { analyseTake } from './take'

// A stand-in for the model with a receptive field of one hop, as the real
// model's is bounded (10 frames ahead, 11 behind): a frame is voiced, at
// a pitch named by its hop's mean, when the hop is louder than 0.05 RMS.
// It records the length of each window it was given.
const hopModel = (): SwiftF0Inference & { windows: Array<number> } => {
  const windows: Array<number> = []
  const infer: SwiftF0Inference = async samples => {
    windows.push(samples.length)
    const frames = frameCount(samples.length)
    const hops = Array.from({ length: frames }, (_, frame) =>
      samples.subarray(frame * swiftF0Hop, (frame + 1) * swiftF0Hop),
    )
    const rms = hops.map(hop =>
      Math.sqrt(hop.reduce((sum, x) => sum + x * x, 0) / hop.length),
    )
    return {
      pitchHz: hops.map(
        hop => 100 + (1000 * hop.reduce((sum, x) => sum + x, 0)) / hop.length,
      ),
      confidence: rms.map(level => (level > 0.05 ? 0.9 : 0.1)),
    }
  }
  return Object.assign(infer, { windows })
}

// Silence, then a rising signal from `amplitude` to twice it, then
// silence: 3 s at 16 kHz.
const takeOf = (amplitude: number): Float32Array =>
  Float32Array.from({ length: 48_000 }, (_, i) =>
    i < 8_000 || i >= 40_000
      ? 0
      : amplitude * (1 + (i - 8_000) / 32_000) * (i % 2 === 0 ? 1 : 0.5),
  )

// Pushes `samples` in 20 ms batches, collecting every frame that comes.
const pushInBatches = async (
  samples: Float32Array,
  infer: SwiftF0Inference,
  flush = false,
): Promise<ReadonlyArray<LiveFrames>> => {
  const tracker = createLiveTracker(infer)
  const received: Array<LiveFrames> = []
  for (let start = 0; start < samples.length; start += 320) {
    const frames = await tracker.push(samples.subarray(start, start + 320))
    if (frames !== null) {
      received.push(frames)
    }
  }
  const last = flush ? await tracker.flush() : null
  return last === null ? received : [...received, last]
}

const joined = (received: ReadonlyArray<LiveFrames>): Array<number> =>
  received.flatMap(frames => Array.from(frames.f0Hz))

describe('the live tracker', () => {
  it('gives each frame once its 10 frames of lookahead are in, in order', async () => {
    const tracker = createLiveTracker(hopModel())
    // Frame 0 comes with the last sample of frame 10.
    expect(await tracker.push(new Float32Array(11 * 256 - 1))).toBe(null)
    const first = await tracker.push(new Float32Array(1))
    expect(first?.firstFrame).toBe(0)
    expect(first?.f0Hz.length).toBe(1)
    expect(await tracker.push(new Float32Array(255))).toBe(null)
    const next = await tracker.push(new Float32Array(256 * 3 + 1))
    expect(next?.firstFrame).toBe(1)
    expect(next?.f0Hz.length).toBe(4)
  })

  it('gives a loud take the frames the whole take gives, but the last 10', async () => {
    const samples = takeOf(0.2)
    const received = await pushInBatches(samples, hopModel())
    const whole = await analyseTake(samples, hopModel())
    expect(whole._tag).toBe('Tracked')
    if (whole._tag !== 'Tracked') {
      return
    }

    received.reduce((next, frames) => {
      expect(frames.firstFrame).toBe(next)
      return next + frames.f0Hz.length
    }, 0)
    const live = joined(received)
    expect(live.length).toBe(frameCount(samples.length) - 10)
    expect(live).toStrictEqual(
      Array.from(whole.curve.f0Hz.subarray(0, live.length)),
    )
  })

  it('gives the last 10 frames when the take ends, as the whole take does', async () => {
    const samples = takeOf(0.2)
    const received = await pushInBatches(samples, hopModel(), true)
    const whole = await analyseTake(samples, hopModel())
    expect(received.at(-1)?.firstFrame).toBe(frameCount(samples.length) - 10)
    expect(
      whole._tag === 'Tracked' && Array.from(whole.curve.f0Hz),
    ).toStrictEqual(joined(received))
    const tracker = createLiveTracker(hopModel())
    expect(await tracker.flush()).toBe(null)
    await tracker.push(new Float32Array(256 * 3))
    expect((await tracker.flush())?.f0Hz.length).toBe(3)
    expect(await tracker.flush()).toBe(null)
  })

  it('reads each frame with 11 frames behind it and 10 ahead', async () => {
    const infer = hopModel()
    await pushInBatches(new Float32Array(16_000), infer)
    // The first window starts at the take's start and ends 10 frames
    // after its one new frame; later ones hold one or two new frames, a
    // 20 ms batch's worth, with their context either side.
    expect(infer.windows[0]).toBe((1 + 10) * 256)
    expect(infer.windows.every(length => length <= (11 + 2 + 10) * 256)).toBe(
      true,
    )
    expect(
      infer.windows.slice(-10).every(length => length >= (11 + 1 + 10) * 256),
    ).toBe(true)
  })

  it('scales a quiet take by its peak so far, so its voice tracks', async () => {
    // Peaks near -40 dBFS, below the -35 that calls for scaling.
    const live = joined(await pushInBatches(takeOf(0.005), hopModel()))
    const voiced = live.filter(hz => hz > 0)
    // The signal runs from frame 31 to frame 156.
    expect(voiced.length).toBeGreaterThanOrEqual(124)
  })

  it('leaves digital silence unvoiced, whatever the model says', async () => {
    const sure: SwiftF0Inference = async samples => {
      const frames = frameCount(samples.length)
      return {
        pitchHz: new Float32Array(frames).fill(200),
        confidence: new Float32Array(frames).fill(0.99),
      }
    }
    const samples = takeOf(0.2)
    const live = joined(await pushInBatches(samples, sure))
    expect(live.slice(0, 31).every(hz => hz === 0)).toBe(true)
    expect(live.slice(157).every(hz => hz === 0)).toBe(true)
    expect(live[100]).toBe(200)
  })
})
