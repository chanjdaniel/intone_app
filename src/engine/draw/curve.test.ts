import { describe, expect, it } from 'vitest'

import {
  type CurveWindow,
  backingSize,
  bridgedGapFrames,
  createCurveStrokerWith,
  createSmoother,
  finishedWindow,
  layOutCurve,
  onePen,
  paintAxis,
  plotArea,
  semitonesOfY,
  yOfSemitones,
} from './curve'

const area = plotArea(400, 200)

const windowOf = (hz: ReadonlyArray<number>, onsetFrame = 0): CurveWindow => {
  const window = finishedWindow({ f0Hz: Float32Array.from(hz), onsetFrame })
  if (window === null) {
    throw new Error('no voiced frame')
  }
  return window
}

const repeat = (hz: number, count: number): Array<number> =>
  Array.from({ length: count }, () => hz)

describe('finishedWindow', () => {
  it('runs from the onset to the last voiced frame, around the median', () => {
    const window = windowOf([0, 0, 100, 200, 0, 100, 50, 0, 0], 2)
    expect(window.firstFrame).toBe(2)
    expect(window.lastFrame).toBe(6)
    expect(window.medianHz).toBe(100)
  })

  it('has nothing to draw with no voiced frame', () => {
    expect(finishedWindow({ f0Hz: new Float32Array(5), onsetFrame: 0 })).toBe(
      null,
    )
  })
})

describe('layOutCurve', () => {
  it('spreads the frames over the span, the median on the middle line', () => {
    const window = windowOf(repeat(100, 11))
    const { runs } = layOutCurve(area, window, 20)
    const run = runs[0] ?? []
    expect(runs).toHaveLength(1)
    expect(run[0]?.x).toBe(area.left)
    expect(run[10]?.x).toBe(area.left + area.width / 2)
    expect(run[5]?.y).toBeCloseTo(area.top + area.height / 2)
  })

  it('is the same drawing for a voice in another register', () => {
    const shape = [120, 125, 130, 160, 150, 0, 0, 110, 100, 95, 90, 92]
    const low = windowOf(shape)
    const high = windowOf(shape.map(hz => hz * 2 ** (7 / 12)))
    const lowLayout = layOutCurve(area, low, 20)
    const highLayout = layOutCurve(area, high, 20)
    lowLayout.runs.flat().forEach((point, i) => {
      const other = highLayout.runs.flat()[i]
      expect(other?.x).toBe(point.x)
      // Float32 frames: the same to a ten-thousandth of a pixel.
      expect(other?.y).toBeCloseTo(point.y, 4)
    })
    expect(highLayout.runs.flat()).toHaveLength(lowLayout.runs.flat().length)
  })

  it('holds a pitch past the axis at its edge', () => {
    const { runs } = layOutCurve(
      area,
      windowOf([...repeat(100, 7), ...repeat(1000, 5)]),
      11,
    )
    expect(runs[0]?.[9]?.y).toBe(area.top)
  })

  it('dashes a gap of up to about 150 ms and leaves a longer one empty', () => {
    const short = repeat(0, bridgedGapFrames)
    const long = repeat(0, bridgedGapFrames + 1)
    const { runs, bridges } = layOutCurve(
      area,
      windowOf([
        ...repeat(100, 5),
        ...short,
        ...repeat(110, 5),
        ...long,
        ...repeat(105, 5),
      ]),
      40,
    )
    expect(runs.map(run => run.length)).toStrictEqual([5, 5, 5])
    expect(bridges).toHaveLength(1)
    expect(bridges[0]?.[0]).toStrictEqual(runs[0]?.at(-1))
    expect(bridges[0]?.[1]).toStrictEqual(runs[1]?.[0])
  })
})

describe('the display smoothing', () => {
  it('draws a one-frame octave slip and jitter at their run’s median', () => {
    const smoother = createSmoother()
    const jittery = [200, 202, 198, 400, 201, 199, 203, 200]
    const window = windowOf(jittery)
    const drawn = jittery.map((_, frame) => smoother(window, frame))
    expect(drawn[3]).toBe(201)
    drawn.forEach(hz => {
      expect(hz).toBeGreaterThanOrEqual(198)
      expect(hz).toBeLessThanOrEqual(203)
    })
  })

  it('never reaches across a gap', () => {
    const smoother = createSmoother()
    const window = windowOf([100, 100, 0, 300, 300])
    expect(smoother(window, 1)).toBe(100)
    expect(smoother(window, 3)).toBe(300)
    expect(smoother(window, 2)).toBe(0)
  })

  it('leaves the frames it reads as they were', () => {
    const f0Hz = Float32Array.of(200, 202, 198, 400, 201, 0, 199, 203)
    const kept = Float32Array.from(f0Hz)
    const window = finishedWindow({ f0Hz, onsetFrame: 0 })
    if (window === null) {
      throw new Error('no voiced frame')
    }
    layOutCurve(area, window, 10)
    createCurveStrokerWith(() => ({
      moveTo: () => undefined,
      lineTo: () => undefined,
    }))(
      {
        lineWidth: 0,
        lineJoin: 'round',
        lineCap: 'round',
        strokeStyle: '',
        setLineDash: () => undefined,
        stroke: () => undefined,
      },
      area,
      window,
      10,
      onePen(2, 'blue'),
    )
    expect(f0Hz).toStrictEqual(kept)
  })
})

describe('the axis', () => {
  it('maps semitones to y and back', () => {
    expect(yOfSemitones(area, 12)).toBe(area.top)
    expect(yOfSemitones(area, -12)).toBe(area.top + area.height)
    expect(semitonesOfY(area, yOfSemitones(area, 3.5))).toBeCloseTo(3.5)
  })

  it('lines every 3 semitones and labels every 6', () => {
    const calls: Array<string> = []
    const record =
      (name: string) =>
      (...args: ReadonlyArray<unknown>) => {
        calls.push(`${name}(${args.join(',')})`)
      }
    paintAxis(
      Object.assign(Object.create(null), {
        clearRect: record('clearRect'),
        beginPath: () => undefined,
        moveTo: () => undefined,
        lineTo: () => undefined,
        stroke: () => calls.push('stroke'),
        fillText: record('fillText'),
      }),
      { width: 400, height: 200 },
      { grid: 'grey', median: 'black', label: 'grey' },
    )
    expect(calls[0]).toBe('clearRect(0,0,400,200)')
    expect(calls.filter(call => call.startsWith('fillText'))).toStrictEqual([
      `fillText(−12,28,190.5)`,
      `fillText(−6,28,145.5)`,
      `fillText(0,28,100.5)`,
      `fillText(+6,28,55.5)`,
      `fillText(+12,28,10.5)`,
    ])
    expect(calls.filter(call => call === 'stroke')).toHaveLength(9)
  })
})

describe('the stroker', () => {
  // Paths that record their moves and lines, and a context that records
  // which path it strokes in which colour, dashed or not.
  const recorder = () => {
    const strokes: Array<string> = []
    let made = 0
    let style = ''
    let dashed = false
    const makePath = () => {
      const id = made++
      const calls: Array<string> = []
      return {
        id,
        calls,
        moveTo: () => calls.push('move'),
        lineTo: () => calls.push('line'),
      }
    }
    type Path = ReturnType<typeof makePath>
    const lineJoin: CanvasLineJoin = 'miter'
    const lineCap: CanvasLineCap = 'butt'
    const context = {
      lineWidth: 0,
      lineJoin,
      lineCap,
      get strokeStyle() {
        return style
      },
      set strokeStyle(colour: string) {
        style = colour
      },
      setLineDash: (segments: Array<number>) => {
        dashed = segments.length > 0
      },
      stroke: (path: Path) =>
        strokes.push(
          `${style}${dashed ? ' dashed' : ''}: ${path.calls.join(' ')}`,
        ),
    }
    return { strokes, context, makePath }
  }

  it('strokes each colour once, its short gaps dashed, a lone frame as a dot', () => {
    const { strokes, context, makePath } = recorder()
    const window = windowOf([
      100,
      110,
      ...repeat(0, 3),
      120,
      ...repeat(0, 20),
      90,
      95,
    ])
    createCurveStrokerWith(makePath)(
      context,
      area,
      window,
      window.lastFrame - window.firstFrame,
      onePen(2, 'blue'),
    )
    // The first run, the frame after the short gap (a dot, a line of no
    // length), and the run after the long gap; then the dash over the
    // short gap.
    expect(strokes).toStrictEqual([
      'blue: move line line move line move line line',
      'blue dashed: move line',
    ])
    expect(context.lineCap).toBe('round')
  })

  it('carries a line on from its last point where the colour changes', () => {
    const { strokes, context, makePath } = recorder()
    const window = windowOf(repeat(100, 6))
    createCurveStrokerWith(makePath)(context, area, window, 5, {
      width: 2,
      colours: ['close', 'middle', 'far'],
      colourAt: frame => (frame < 3 ? 0 : 2),
    })
    // Nothing is in the middle colour, so it is not stroked.
    expect(strokes).toStrictEqual([
      'close: move line line line',
      'far: move line line line',
    ])
  })
})

describe('backingSize', () => {
  it('gives each CSS pixel whole device pixels', () => {
    expect(backingSize(390, 224, 3)).toStrictEqual({ width: 1170, height: 672 })
    expect(backingSize(300.4, 100, 1.5)).toStrictEqual({
      width: 451,
      height: 150,
    })
  })
})
