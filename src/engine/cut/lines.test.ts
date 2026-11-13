import { describe, expect, test } from 'vitest'

import { type CutLine, cutLines, cutRules } from './lines'

// Probabilities one per 32 ms window (512 samples at 16 kHz), from a
// plan of stretches: speech at 0.9, quiet at 0.05, and any other level
// given as such.
const window = 512
const rate = 16_000

type Stretch = Readonly<{ seconds: number; probability: number }>
const speech = (seconds: number): Stretch => ({ seconds, probability: 0.9 })
const quiet = (seconds: number): Stretch => ({ seconds, probability: 0.05 })
const level = (seconds: number, probability: number): Stretch => ({
  seconds,
  probability,
})

const probabilitiesOf = (
  plan: ReadonlyArray<Stretch>,
): { probabilities: Float32Array; sampleCount: number } => {
  const windows = plan.flatMap(({ seconds, probability }) =>
    Array.from({ length: Math.round((seconds * rate) / window) }, () =>
      Math.fround(probability),
    ),
  )
  return {
    probabilities: Float32Array.from(windows),
    sampleCount: windows.length * window,
  }
}

const cut = (plan: ReadonlyArray<Stretch>): ReadonlyArray<CutLine> => {
  const { probabilities, sampleCount } = probabilitiesOf(plan)
  return cutLines(probabilities, window, sampleCount)
}

const seconds = (lines: ReadonlyArray<CutLine>) =>
  lines.map(({ from, to }) => [from / rate, to / rate])

const lead = cutRules.leadSeconds
const tail = cutRules.tailSeconds

describe('cutLines', () => {
  test('silence alone has no line', () => {
    expect(cut([quiet(10)])).toEqual([])
  })

  test('a pause of 300 ms or more cuts one line from the next', () => {
    const lines = cut([
      quiet(1),
      speech(2),
      quiet(0.416),
      speech(1.6),
      quiet(1),
    ])
    expect(lines).toHaveLength(2)
  })

  test('a shorter pause stays inside the line', () => {
    const lines = cut([
      quiet(1),
      speech(1.5),
      quiet(0.192),
      speech(1.5),
      quiet(1),
    ])
    expect(lines).toHaveLength(1)
  })

  test('each line keeps a lead and a tail of the quiet around it', () => {
    const [line] = seconds(cut([quiet(1.024), speech(2.048), quiet(1.024)]))
    expect(line?.[0]).toBeCloseTo(1.024 - lead, 3)
    expect(line?.[1]).toBeCloseTo(1.024 + 2.048 + tail, 3)
  })

  test('two lines close together each take no more than half the pause between them', () => {
    const lines = seconds(
      cut([quiet(1.024), speech(2.048), quiet(0.32), speech(2.048), quiet(1)]),
    )
    expect(lines).toHaveLength(2)
    const middle = 1.024 + 2.048 + 0.16
    expect(lines[0]?.[1]).toBeCloseTo(middle, 3)
    expect(lines[1]?.[0]).toBeCloseTo(1.024 + 2.048 + 0.32 - lead, 3)
    expect(lines[1]?.[0]).toBeGreaterThanOrEqual(middle)
  })

  test('a line never reaches past the clip', () => {
    const { probabilities, sampleCount } = probabilitiesOf([speech(2)])
    const [line] = cutLines(probabilities, window, sampleCount)
    expect(line).toEqual({ from: 0, to: sampleCount })
  })

  test('a click shorter than 250 ms is left out', () => {
    expect(cut([quiet(2), speech(0.16), quiet(2)])).toEqual([])
  })

  test('the lower threshold holds speech through a dip', () => {
    const lines = cut([
      quiet(1),
      speech(1.5),
      level(0.6, 0.4),
      speech(1.5),
      quiet(1),
    ])
    expect(lines).toHaveLength(1)
  })

  test('a line longer than 4 s is cut at its longest inner silence', () => {
    const lines = seconds(
      cut([
        quiet(1),
        speech(1.5),
        quiet(0.128),
        speech(1.5),
        quiet(0.256),
        speech(1.5),
        quiet(1),
      ]),
    )
    expect(lines).toHaveLength(2)
    expect(lines[0]?.[1]).toBeCloseTo(1 + 1.5 + 0.128 + 1.5 + 0.128, 1)
  })

  test('a long stretch with no silence is cut into pieces of at most 4 s', () => {
    const lines = cut([quiet(1), speech(11), quiet(1)])
    expect(lines.length).toBeGreaterThanOrEqual(3)
    lines.forEach(({ from, to }) => {
      expect(to - from).toBeLessThanOrEqual(
        (cutRules.longestLineSeconds + lead + tail) * rate,
      )
    })
  })

  test('a word too short to copy alone joins its neighbour across a short pause', () => {
    const lines = cut([
      quiet(1),
      speech(2),
      quiet(0.48),
      speech(0.48),
      quiet(2),
    ])
    expect(lines).toHaveLength(1)
  })

  test('a short word stays alone after a long pause', () => {
    const lines = cut([quiet(1), speech(2), quiet(1.6), speech(0.48), quiet(2)])
    expect(lines).toHaveLength(2)
  })

  test('a short word joins the nearer of its neighbours', () => {
    const lines = seconds(
      cut([
        quiet(1),
        speech(2),
        quiet(0.64),
        speech(0.48),
        quiet(0.352),
        speech(2),
        quiet(1),
      ]),
    )
    expect(lines).toHaveLength(2)
    expect(lines[1]?.[1]! - lines[1]?.[0]!).toBeGreaterThan(2.5)
  })

  test('a join never makes a line longer than 4 s', () => {
    const lines = cut([
      quiet(1),
      speech(3.84),
      quiet(0.48),
      speech(0.48),
      quiet(2),
    ])
    expect(lines).toHaveLength(2)
  })

  test('lines are in order and never overlap', () => {
    const plan = Array.from({ length: 30 }, (_, k) => [
      speech(0.3 + ((k * 7) % 11) * 0.4),
      quiet(0.2 + ((k * 5) % 7) * 0.2),
    ]).flat()
    const lines = cut([quiet(0.5), ...plan])
    lines.forEach((line, k) => {
      expect(line.to).toBeGreaterThan(line.from)
      const next = lines[k + 1]
      if (next !== undefined) {
        expect(next.from).toBeGreaterThanOrEqual(line.to)
      }
    })
  })
})
