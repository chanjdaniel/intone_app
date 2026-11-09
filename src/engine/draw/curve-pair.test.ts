import { describe, expect, it, vi } from 'vitest'

import {
  type CurveWindow,
  createSmoother,
  finishedWindow,
  plotArea,
  walkCurve,
} from './curve'
import {
  type PairColours,
  closenessReachFrames,
  closenessStep,
  learnerPen,
  nativeReferenceOf,
  paintLearnerLayer,
  paintNativeLayer,
  pairSpanFrames,
} from './curve-pair'
import { finishedLiveCurve } from './live-curve'

const repeat = (hz: number, count: number): Array<number> =>
  Array.from({ length: count }, () => hz)

const windowOf = (hz: ReadonlyArray<number>, onsetFrame = 0): CurveWindow => {
  const window = finishedWindow({ f0Hz: Float32Array.from(hz), onsetFrame })
  if (window === null) {
    throw new Error('no voiced frame')
  }
  return window
}

// A line that is high, then falls 6 semitones: the shape of あ↓めが.
const nativeShape = [...repeat(200, 20), ...repeat(200 * 2 ** (-6 / 12), 20)]
const reference = nativeReferenceOf(windowOf(nativeShape))

const colours: PairColours = {
  grid: 'grid',
  median: 'median',
  label: 'label',
  native: 'native',
  ramp: ['closest', 'close', 'middle', 'far', 'farthest'],
  mark: 'mark',
}

// Each drawn frame's step on the ramp, in order.
const stepsOf = (learner: CurveWindow): Array<number> => {
  const pen = learnerPen(colours, learner, reference)
  const steps: Array<number> = []
  const visit = (_x: number, _y: number, frame: number, hz: number): void => {
    steps.push(pen.colourAt(frame, hz))
  }
  walkCurve(plotArea(400, 200), learner, 60, createSmoother(), {
    runStart: visit,
    bridge: visit,
    point: visit,
  })
  return steps
}

describe('closeness to the native', () => {
  it('is closest for the same shape in a voice an octave and a fifth lower', () => {
    const learner = windowOf(nativeShape.map(hz => hz / 2 ** (19 / 12)))
    expect(new Set(stepsOf(learner))).toStrictEqual(new Set([0]))
  })

  it('steps a semitone at a time, to the farthest past 4', () => {
    expect(closenessStep(reference, 5, 3 + 0.5)).toBe(0)
    expect(closenessStep(reference, 5, 3 + 2.5)).toBe(2)
    expect(closenessStep(reference, 5, 3 + 4)).toBe(4)
    expect(closenessStep(reference, 5, 3 + 9)).toBe(4)
  })

  it('looks about 150 ms either way, so a fall a little late still matches', () => {
    // The native falls at frame 20; at frame 15 a learner already low is
    // within reach of it, and at frame 10 is not.
    expect(closenessStep(reference, 20 - closenessReachFrames, -3)).toBe(0)
    expect(closenessStep(reference, 20 - closenessReachFrames - 1, -3)).toBe(4)
  })

  it('is farthest where the native has no voice near', () => {
    expect(closenessStep(reference, 40 + closenessReachFrames + 1, 0)).toBe(4)
  })

  it('marks a take that misses the fall away from the native all along', () => {
    // Flat, so its median is its one pitch, and both halves of the native
    // are about 3 semitones from it.
    const steps = stepsOf(windowOf(repeat(300, 40)))
    expect(Math.min(...steps)).toBeGreaterThanOrEqual(2)
  })
})

describe('shifting a take’s register', () => {
  it('leaves its drawing and its colours as they were', () => {
    const take = [0, 0, 180, 185, 190, 200, 0, 0, 170, 160, 150, 150, 155]
    const drawn = (shift: number) => {
      const learner = windowOf(
        take.map(hz => hz * 2 ** (shift / 12)),
        2,
      )
      const points: Array<readonly [number, number, number]> = []
      const pen = learnerPen(colours, learner, reference)
      const visit = (x: number, y: number, frame: number, hz: number) => {
        points.push([x, Math.round(y * 1e4) / 1e4, pen.colourAt(frame, hz)])
      }
      walkCurve(plotArea(400, 200), learner, 60, createSmoother(), {
        runStart: visit,
        bridge: visit,
        point: visit,
      })
      return points
    }
    expect(drawn(-14)).toStrictEqual(drawn(0))
    expect(drawn(9.5)).toStrictEqual(drawn(0))
  })
})

describe('the shared width', () => {
  it('leaves a quarter more than the native line', () => {
    expect(pairSpanFrames(80, 0)).toBe(100)
    expect(pairSpanFrames(80, 100)).toBe(100)
  })

  it('grows by half again each time the take runs past it', () => {
    expect(pairSpanFrames(80, 101)).toBe(150)
    expect(pairSpanFrames(80, 151)).toBe(225)
    expect(pairSpanFrames(0, 0)).toBe(31)
  })
})

describe('painting the pair', () => {
  const quiet = () =>
    Object.assign(Object.create(null), {
      clearRect: () => undefined,
      setTransform: () => undefined,
      beginPath: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      arc: () => undefined,
      stroke: () => undefined,
      fill: () => undefined,
      fillText: () => undefined,
      fillRect: () => undefined,
      setLineDash: () => undefined,
    })

  it('shades a marked stretch of the native behind both curves, across the plot', () => {
    vi.stubGlobal(
      'Path2D',
      class {
        moveTo(): void {}
        lineTo(): void {}
      },
    )
    const filled: Array<Readonly<{ style: unknown; rect: Array<number> }>> = []
    const context = Object.assign(quiet(), {
      fillStyle: '',
      fillRect(...rect: Array<number>) {
        filled.push({ style: this.fillStyle, rect })
      },
    })
    const native = windowOf(nativeShape, 0)
    const size = { width: 400, height: 200 }
    const area = plotArea(size.width, size.height)
    paintNativeLayer(context, size, colours, native, 60, undefined, {
      fromFrame: 15,
      toFrame: 27,
    })
    expect(filled).toStrictEqual([
      {
        style: 'mark',
        rect: [
          area.left + (15 / 60) * area.width,
          area.top,
          (12 / 60) * area.width,
          area.height,
        ],
      },
    ])
    // A stretch that starts before the native's onset, or runs past the
    // width, is shaded only over the plot.
    filled.length = 0
    paintNativeLayer(context, size, colours, native, 60, undefined, {
      fromFrame: -8,
      toFrame: 70,
    })
    expect(filled).toStrictEqual([
      {
        style: 'mark',
        rect: [area.left, area.top, area.width, area.height],
      },
    ])
    filled.length = 0
    paintNativeLayer(context, size, colours, native, 60)
    expect(filled).toStrictEqual([])
    vi.unstubAllGlobals()
  })

  it('keeps the raw frames for scoring as the tracker gave them', () => {
    // happy-dom has no Path2D; one that draws nothing stands in.
    vi.stubGlobal(
      'Path2D',
      class {
        moveTo(): void {}
        lineTo(): void {}
      },
    )
    const jittery = Float32Array.from(
      Array.from({ length: 60 }, (_, i) =>
        i % 7 === 3 ? 0 : 150 + (i % 2 === 0 ? 4 : -4) + (i === 30 ? 150 : 0),
      ),
    )
    const raw = Float32Array.from(jittery)
    const native = Float32Array.from(nativeShape)
    const rawNative = Float32Array.from(native)
    const learner = finishedLiveCurve(jittery)
    learner.advance(0)
    const nativeWindow = finishedWindow({ f0Hz: native, onsetFrame: 0 })
    if (nativeWindow === null) {
      throw new Error('no voiced frame')
    }
    const size = { width: 400, height: 200 }
    paintNativeLayer(quiet(), size, colours, nativeWindow, 60)
    paintLearnerLayer(
      quiet(),
      size,
      colours,
      learner.window(),
      nativeReferenceOf(nativeWindow),
      60,
    )
    expect(jittery).toStrictEqual(raw)
    expect(native).toStrictEqual(rawNative)
    const window = learner.window()
    expect(
      Float32Array.from({ length: 60 }, (_, frame) => window?.f0At(frame) ?? 0),
    ).toStrictEqual(raw)
    vi.unstubAllGlobals()
  })
})
