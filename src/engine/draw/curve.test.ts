import { describe, expect, it } from 'vitest'

import {
  backingSize,
  layOutCurve,
  paintCurve,
  plotArea,
  semitonesOfY,
  yOfSemitones,
} from './curve'

const area = plotArea(400, 200)

// Ten frames: unvoiced, then 100, 200 (an octave up), a gap, 100, 50, and
// trailing silence.
const f0Hz = Float32Array.of(0, 0, 100, 200, 0, 100, 50, 0, 0, 0)

describe('layOutCurve', () => {
  it('draws from the onset to the last voiced frame, a run per voiced stretch', () => {
    const drawing = layOutCurve({ f0Hz, onsetFrame: 2 }, area)
    expect(drawing?.medianHz).toBe(100)
    expect(drawing?.firstFrame).toBe(2)
    expect(drawing?.lastFrame).toBe(6)
    expect(drawing?.runs.map(run => run.length)).toStrictEqual([2, 2])
    const [first, second] = drawing?.runs ?? []
    expect(first?.[0]?.x).toBe(area.left)
    expect(second?.[1]?.x).toBe(area.left + area.width)
    expect(second?.[0]?.x).toBe(area.left + (3 / 4) * area.width)
  })

  it('places the median on the middle line and an octave 12 semitones from it', () => {
    const drawing = layOutCurve({ f0Hz, onsetFrame: 2 }, area)
    const [first, second] = drawing?.runs ?? []
    expect(first?.[0]?.y).toBeCloseTo(area.top + area.height / 2)
    expect(semitonesOfY(area, first?.[1]?.y ?? 0)).toBeCloseTo(12)
    expect(semitonesOfY(area, second?.[1]?.y ?? 0)).toBeCloseTo(-12)
  })

  it('is the same shape for a voice an octave higher', () => {
    const low = layOutCurve({ f0Hz, onsetFrame: 2 }, area)
    const high = layOutCurve(
      { f0Hz: f0Hz.map(hz => hz * 2), onsetFrame: 2 },
      area,
    )
    expect(high?.runs).toStrictEqual(low?.runs)
  })

  it('holds a pitch past the axis at its edge', () => {
    const drawing = layOutCurve(
      { f0Hz: Float32Array.of(100, 100, 100, 1000), onsetFrame: 0 },
      area,
    )
    expect(drawing?.runs[0]?.[3]?.y).toBe(area.top)
  })

  it('gives nothing to draw with no voiced frame', () => {
    expect(
      layOutCurve({ f0Hz: new Float32Array(5), onsetFrame: 0 }, area),
    ).toBe(null)
  })
})

describe('the axis', () => {
  it('maps semitones to y and back', () => {
    expect(yOfSemitones(area, 12)).toBe(area.top)
    expect(yOfSemitones(area, -12)).toBe(area.top + area.height)
    expect(semitonesOfY(area, yOfSemitones(area, 3.5))).toBeCloseTo(3.5)
  })
})

describe('paintCurve', () => {
  it('strokes the grid, labels every 6 semitones, then one path per run and a dot for a lone frame', () => {
    const calls: Array<string> = []
    const record =
      (name: string) =>
      (...args: ReadonlyArray<unknown>) => {
        calls.push(`${name}(${args.join(',')})`)
      }
    const context = {
      clearRect: record('clearRect'),
      beginPath: () => calls.push('beginPath'),
      moveTo: () => undefined,
      lineTo: () => undefined,
      arc: () => undefined,
      stroke: () => calls.push('stroke'),
      fill: () => calls.push('fill'),
      fillText: record('fillText'),
    }
    paintCurve(
      // A stand-in that records the calls this test reads.
      Object.assign(Object.create(null), context),
      { f0Hz: Float32Array.of(100, 110, 0, 120, 0, 90, 95), onsetFrame: 0 },
      { width: 400, height: 200 },
      { curve: 'blue', grid: 'grey', median: 'black', label: 'grey' },
    )
    expect(calls[0]).toBe('clearRect(0,0,400,200)')
    expect(calls.filter(call => call.startsWith('fillText'))).toStrictEqual([
      `fillText(\u221212,28,190.5)`,
      `fillText(\u22126,28,145.5)`,
      `fillText(0,28,100.5)`,
      `fillText(+6,28,55.5)`,
      `fillText(+12,28,10.5)`,
    ])
    // Nine grid lines, then two runs stroked and one lone frame filled.
    expect(calls.filter(call => call === 'stroke')).toHaveLength(11)
    expect(calls.filter(call => call === 'fill')).toHaveLength(1)
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
