import { Option } from 'effect'
import { describe, expect, test } from 'vitest'

import { blindChartOf, describeBlindChart } from './blindChart'
import type { BlindPoint } from './history'

// A line's blind takes over time: placed by when each was made, filled
// where it reached the threshold, and said in words for a screen reader.

const dayMs = 86_400_000
const nov9 = Date.UTC(2026, 10, 9, 10)

const point = (days: number, match: number | null): BlindPoint => ({
  takenAt: nov9 + days * dayMs,
  day: new Date(nov9 + days * dayMs).toISOString().slice(0, 10),
  maybeMatch: Option.fromNullishOr(match),
})

describe('the blind-take chart', () => {
  test('places each take by its time, not its count, the first left and the latest right', () => {
    const { dots } = blindChartOf([
      point(0, 0.6),
      point(1, 0.8),
      point(10, 0.9),
    ])
    expect(dots.map(dot => Math.round(dot.x))).toEqual([8, 66, 592])
    expect(dots.map(dot => dot.reached)).toEqual([false, true, true])
    expect(dots[0]!.y).toBeGreaterThan(dots[2]!.y)
  })

  test('puts a lone take in the middle', () => {
    expect(blindChartOf([point(0, 0.8)]).dots).toEqual([
      { x: 300, y: expect.any(Number), reached: true },
    ])
  })

  test('breaks the line at a take that could not be compared, and draws it no dot', () => {
    const { dots, runs } = blindChartOf([
      point(0, 0.6),
      point(1, 0.7),
      point(2, null),
      point(3, 0.8),
      point(4, 0.85),
    ])
    expect(dots).toHaveLength(4)
    expect(runs).toHaveLength(2)
  })

  test('is summed up for a screen reader as its first, latest and best, and how many reached', () => {
    expect(
      describeBlindChart([
        point(0, 0.62),
        point(1, 0.91),
        point(4, null),
        point(11, 0.78),
      ]),
    ).toBe(
      'Your blind takes of this line: 4 takes from 9 November 2026 to 20 November 2026: first 62%, latest 78%, best 91%. 2 of 3 reached the threshold of 75%. 1 take could not be compared.',
    )
    expect(describeBlindChart([point(0, null)])).toBe(
      'Your blind takes of this line: 1 take, none of them compared. The threshold is 75%.',
    )
  })
})
