import { describe, expect, test } from 'vitest'

import {
  type Span,
  canSplit,
  edgeLimits,
  mergedSpan,
  movedEdge,
  onSampleGrid,
  shortestLineSeconds,
  splitSpans,
} from './edit'

// A clip of 20 s with three lines: two with a pause between them, and a
// third that touches the second, as a split leaves it.
const clipSeconds = 20
const spans: ReadonlyArray<Span> = [
  { from: 1, to: 3 },
  { from: 4, to: 6 },
  { from: 6, to: 8.5 },
]

describe('moving an edge', () => {
  test('moves only the edge asked for, on the sample grid', () => {
    const moved = movedEdge(spans, 0, 'to', 3.123_456, clipSeconds)
    expect(moved[0]).toStrictEqual({ from: 1, to: onSampleGrid(3.123_456) })
    expect(moved[1]).toStrictEqual(spans[1])
    expect(moved[2]).toStrictEqual(spans[2])
    expect(onSampleGrid(3.123_456) * 16_000).toBe(
      Math.round(3.123_456 * 16_000),
    )
  })

  test('stops at the neighbour across a pause, never overlapping it', () => {
    expect(movedEdge(spans, 0, 'to', 5, clipSeconds)[0]?.to).toBe(4)
    expect(movedEdge(spans, 1, 'from', 2, clipSeconds)[1]?.from).toBe(3)
  })

  test('keeps a line at least the shortest line long', () => {
    expect(movedEdge(spans, 0, 'to', 0, clipSeconds)[0]?.to).toBe(
      onSampleGrid(1 + shortestLineSeconds),
    )
    expect(movedEdge(spans, 0, 'from', 9, clipSeconds)[0]?.from).toBe(
      onSampleGrid(3 - shortestLineSeconds),
    )
  })

  test('stops at the clip’s start and end', () => {
    expect(movedEdge(spans, 0, 'from', -2, clipSeconds)[0]?.from).toBe(0)
    expect(movedEdge(spans, 2, 'to', 40, clipSeconds)[2]?.to).toBe(clipSeconds)
  })

  test('moves an edge two lines share as one, keeping both long enough', () => {
    const moved = movedEdge(spans, 1, 'to', 5.5, clipSeconds)
    expect(moved[1]).toStrictEqual({ from: 4, to: 5.5 })
    expect(moved[2]).toStrictEqual({ from: 5.5, to: 8.5 })
    const fromLater = movedEdge(spans, 2, 'from', 7, clipSeconds)
    expect(fromLater[1]?.to).toBe(7)
    expect(fromLater[2]?.from).toBe(7)
    expect(movedEdge(spans, 1, 'to', 9, clipSeconds)[2]?.from).toBe(
      onSampleGrid(8.5 - shortestLineSeconds),
    )
  })

  test('names the limits the edge moves between', () => {
    expect(edgeLimits(spans, 0, 'to', clipSeconds)).toStrictEqual({
      least: onSampleGrid(1 + shortestLineSeconds),
      most: 4,
      shared: false,
    })
    expect(edgeLimits(spans, 1, 'to', clipSeconds)).toStrictEqual({
      least: onSampleGrid(4 + shortestLineSeconds),
      most: onSampleGrid(8.5 - shortestLineSeconds),
      shared: true,
    })
  })
})

describe('splitting, merging', () => {
  test('a line splits at a point inside it into two that touch', () => {
    expect(canSplit({ from: 1, to: 3 }, 2)).toBe(true)
    expect(splitSpans({ from: 1, to: 3 }, 2.000_01)).toStrictEqual([
      { from: 1, to: onSampleGrid(2.000_01) },
      { from: onSampleGrid(2.000_01), to: 3 },
    ])
  })

  test('a split leaving a part shorter than the shortest line is refused', () => {
    expect(canSplit({ from: 1, to: 3 }, 1.1)).toBe(false)
    expect(canSplit({ from: 1, to: 3 }, 2.9)).toBe(false)
    expect(canSplit({ from: 1, to: 3 }, 4)).toBe(false)
  })

  test('two neighbours merge into one, the pause between them with them', () => {
    expect(mergedSpan({ from: 1, to: 3 }, { from: 4, to: 6 })).toStrictEqual({
      from: 1,
      to: 6,
    })
  })
})
