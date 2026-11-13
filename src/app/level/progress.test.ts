import { Option } from 'effect'
import { describe, expect, test } from 'vitest'

import { LineAsKept, lineProgressOf } from '../history/history'
import {
  couldNotCompare,
  dayMs,
  entryOf,
  nov9,
  scoredAt,
} from '../history/testEntries'
import { type LevelSource, nextLineOf } from './commands'
import { noProgress } from './progress'

// A line's stars and best, worked out from the takes kept on the device:
// they are kept per line in the history as the takes that earned them,
// each with its mode and score.

describe('a line’s stars and best, from its takes on the device', () => {
  test('are none for a line with no takes', () => {
    expect(
      lineProgressOf([], 'ame-ga-suki', '1', LineAsKept.Bundled()),
    ).toStrictEqual(noProgress)
  })

  test('keep the most any take earned and the best match, whatever came after', () => {
    const entries = [
      entryOf({ id: 'a', takenAt: nov9, score: scoredAt(0.93) }),
      entryOf({ id: 'b', takenAt: nov9 + 1, score: scoredAt(0.4) }),
      entryOf({
        id: 'c',
        takenAt: nov9 + 2,
        mode: 'Blind',
        score: scoredAt(0.5),
      }),
      entryOf({ id: 'd', takenAt: nov9 + 3, score: couldNotCompare() }),
    ]
    expect(
      lineProgressOf(entries, 'ame-ga-suki', '1', LineAsKept.Bundled()),
    ).toStrictEqual({ stars: 2, maybeBestMatch: Option.some(0.93) })
  })

  test('give three for a blind take that reaches the threshold, on any day', () => {
    const entries = [
      entryOf({
        id: 'a',
        takenAt: nov9 + 3 * dayMs,
        mode: 'Blind',
        score: scoredAt(0.76),
      }),
    ]
    expect(
      lineProgressOf(entries, 'ame-ga-suki', '1', LineAsKept.Bundled()),
    ).toStrictEqual({ stars: 3, maybeBestMatch: Option.some(0.76) })
  })

  test('count only the line’s own takes', () => {
    const entries = [
      entryOf({ id: 'a', takenAt: nov9, lineId: '2', score: scoredAt(1) }),
      entryOf({ id: 'b', takenAt: nov9, clipId: 'c1', score: scoredAt(1) }),
    ]
    expect(
      lineProgressOf(entries, 'ame-ga-suki', '1', LineAsKept.Bundled()),
    ).toStrictEqual(noProgress)
  })

  test('start again on a line whose span changed, as its earlier takes copied other audio', () => {
    const entries = [
      entryOf({
        id: 'a',
        takenAt: nov9,
        clipId: 'c1',
        nativeId: 'before',
        mode: 'Blind',
        score: scoredAt(0.9),
      }),
      entryOf({
        id: 'b',
        takenAt: nov9 + dayMs,
        clipId: 'c1',
        nativeId: 'now',
        score: scoredAt(0.8),
      }),
    ]
    expect(
      lineProgressOf(
        entries,
        'c1',
        '1',
        LineAsKept.Current({ maybeNativeId: Option.some('now') }),
      ),
    ).toStrictEqual({ stars: 1, maybeBestMatch: Option.some(0.8) })
    expect(
      lineProgressOf(
        entries.slice(0, 1),
        'c1',
        '1',
        LineAsKept.Current({ maybeNativeId: Option.some('now') }),
      ),
    ).toStrictEqual(noProgress)
  })
})

describe('the next line', () => {
  const source: LevelSource = {
    name: 'reading.mp3',
    lines: ['1', '2', '3', '4'].map(lineId => ({
      lineId,
      title: `Line ${lineId}`,
      titleIsText: false,
      copyable: lineId !== '3',
      asKept: LineAsKept.Current({ maybeNativeId: Option.some(lineId) }),
    })),
  }

  test('is the next one that can be copied', () => {
    expect(nextLineOf(source, '1')).toStrictEqual(
      Option.some({ lineId: '2', title: 'Line 2', titleIsText: false }),
    )
    expect(nextLineOf(source, '2')).toStrictEqual(
      Option.some({ lineId: '4', title: 'Line 4', titleIsText: false }),
    )
  })

  test('is none after the last, or for a line not in the level', () => {
    expect(nextLineOf(source, '4')).toStrictEqual(Option.none())
    expect(nextLineOf(source, '9')).toStrictEqual(Option.none())
  })
})
