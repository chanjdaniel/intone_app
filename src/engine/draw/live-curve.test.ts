import { describe, expect, it } from 'vitest'

import { medianVoicedHz, semitonesFrom } from '../../score/curve'
import { finishedWindow } from './curve'
import {
  createLiveCurve,
  finishedLiveCurve,
  medianSettleMs,
  windowCurve,
} from './live-curve'

const frames = (firstFrame: number, hz: ReadonlyArray<number>) => ({
  firstFrame,
  f0Hz: Float32Array.from(hz),
})

const repeat = (hz: number, count: number): Array<number> =>
  Array.from({ length: count }, () => hz)

describe('the live curve', () => {
  it('draws nothing before the voice onset, then starts at it', () => {
    const curve = createLiveCurve(2048)
    curve.append(frames(0, [0, 0, 120, 0, 0]))
    expect(curve.advance(0)).toBe(true)
    expect(curve.window()).toBe(null)

    curve.append(frames(5, [130, 131, 132, 133]))
    curve.advance(16)
    const window = curve.window()
    expect(window?.firstFrame).toBe(5)
    expect(window?.lastFrame).toBe(8)
    expect(window?.f0At(6)).toBeCloseTo(131, 3)
  })

  it('settles towards a new median rather than jumping to it', () => {
    const curve = createLiveCurve(2048)
    curve.append(frames(0, repeat(100, 10)))
    curve.advance(0)
    expect(curve.window()?.medianHz).toBeCloseTo(100, 6)

    // The running median moves to 200 Hz, 12 semitones up.
    curve.append(frames(10, repeat(200, 30)))
    const drawn = (nowMs: number): number => {
      curve.advance(nowMs)
      return semitonesFrom(100, curve.window()?.medianHz ?? Number.NaN)
    }
    // An animation frame every 16 ms for 5 s.
    const steps = Array.from({ length: 313 }, (_, i) => drawn(16 * (i + 1)))
    // Each frame closer, by less than half a semitone, never past it.
    steps.reduce((previous, step) => {
      expect(step).toBeGreaterThanOrEqual(previous)
      expect(step - previous).toBeLessThan(0.5)
      expect(step).toBeLessThanOrEqual(12)
      return step
    }, 0)
    // 63% of the way after one settling time, and there by 5 s.
    expect(steps[medianSettleMs / 16 - 1]).toBeCloseTo(
      12 * (1 - Math.exp(-1)),
      1,
    )
    expect(steps.at(-1)).toBeCloseTo(12, 9)
  })

  it('says when nothing has changed, so an animation frame can skip painting', () => {
    const curve = createLiveCurve(2048)
    curve.append(frames(0, repeat(100, 10)))
    expect(curve.advance(0)).toBe(true)
    expect(curve.advance(16)).toBe(false)
    curve.append(frames(10, [0]))
    expect(curve.advance(32)).toBe(true)
    expect(curve.advance(48)).toBe(false)
  })

  it('snaps to the finished curve when the take ends', () => {
    const f0Hz = [0, 0, 0, 100, 110, 120, 0, 0, 180, 190, 200, 210, 0, 0, 0]
    const curve = createLiveCurve(2048)
    curve.append(frames(0, f0Hz.slice(0, 6)))
    curve.advance(0)
    curve.append(frames(6, f0Hz.slice(6)))
    curve.advance(16)
    // Still settling towards the new median.
    expect(curve.window()?.medianHz).not.toBeCloseTo(
      medianVoicedHz(Float32Array.from(f0Hz)),
      1,
    )

    curve.finish()
    expect(curve.advance(32)).toBe(true)
    const finished = finishedWindow({
      f0Hz: Float32Array.from(f0Hz),
      onsetFrame: 3,
    })
    const window = curve.window()
    expect(window?.firstFrame).toBe(finished?.firstFrame)
    expect(window?.lastFrame).toBe(finished?.lastFrame)
    expect(window?.medianHz).toBeCloseTo(finished?.medianHz ?? Number.NaN, 4)

    // Nothing comes after the end.
    curve.append(frames(15, [300]))
    expect(curve.framesIn()).toBe(15)
  })

  it('keeps the newest frames of a take longer than its ring', () => {
    const curve = createLiveCurve(64)
    curve.append(frames(0, repeat(100, 50)))
    curve.append(frames(50, repeat(200, 50)))
    curve.advance(0)
    const window = curve.window()
    expect(window?.firstFrame).toBe(36)
    expect(window?.f0At(35)).toBe(0)
    expect(window?.f0At(40)).toBe(100)
    expect(window?.f0At(99)).toBe(200)
    expect(curve.newestVoicedFrame()).toBe(99)
  })

  it('ignores frames that do not follow the last', () => {
    const curve = createLiveCurve(2048)
    curve.append(frames(0, repeat(100, 5)))
    curve.append(frames(8, repeat(100, 5)))
    expect(curve.framesIn()).toBe(5)
  })

  it('shows a finished curve as a live one that has ended', () => {
    const f0Hz = Float32Array.of(0, 0, 100, 110, 120, 0, 130, 0, 0)
    const curve = finishedLiveCurve(f0Hz)
    expect(curve.advance(0)).toBe(true)
    const window = curve.window()
    const finished = finishedWindow({ f0Hz, onsetFrame: 2 })
    expect(window?.firstFrame).toBe(finished?.firstFrame)
    expect(window?.lastFrame).toBe(finished?.lastFrame)
    expect(window?.medianHz).toBeCloseTo(finished?.medianHz ?? Number.NaN, 4)
    expect(window?.f0At(6)).toBe(130)
  })

  it('shows a curve in a window it is given, as one that has ended', () => {
    const f0Hz = Float32Array.of(0, 0, 100, 110, 0, 130, 0, 0)
    const curve = windowCurve({
      f0At: frame => f0Hz[frame] ?? 0,
      firstFrame: 1,
      lastFrame: 6,
      medianHz: 115,
    })
    expect(curve.advance(0)).toBe(true)
    expect(curve.advance(16)).toBe(false)
    expect(curve.window()).toMatchObject({
      firstFrame: 1,
      lastFrame: 6,
      medianHz: 115,
    })
    expect(curve.window()?.f0At(5)).toBe(130)
    expect(curve.framesIn()).toBe(7)
    expect(curve.newestVoicedFrame()).toBe(5)
  })
})
