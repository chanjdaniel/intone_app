import { Option } from 'effect'
import { Calendar } from 'foldkit'
import { describe, expect, test } from 'vitest'

import { monthTotals, weeksOf } from './calendar'
import { bytesText, dayText } from './format'
import { lineTakesOf, summarise, trendOf } from './history'
import { couldNotCompare, dayMs, entryOf, nov9, scoredAt } from './testEntries'
import { describeTrend, trendRuns } from './trend'

const other = { clipId: 'kaze', lineId: '2', lineText: '風が吹く' }

describe('the history’s sums', () => {
  const entries = [
    entryOf({ id: 'a', takenAt: nov9, score: scoredAt(0.4) }),
    entryOf({ id: 'b', takenAt: nov9 + 60_000, score: scoredAt(0.9) }),
    entryOf({ id: 'c', takenAt: nov9 + 2 * dayMs, score: couldNotCompare() }),
    entryOf({
      id: 'd',
      takenAt: nov9 + dayMs,
      score: scoredAt(0.7, 0),
      ...other,
    }),
  ]

  test('list each line once, the most recently practised first, with its best and latest match', () => {
    const { lines } = summarise(entries)
    expect(lines.map(line => line.lineText)).toEqual(['雨が好き', '風が吹く'])
    expect(lines[0]).toEqual({
      clipId: 'ame-ga-suki',
      lineId: '1',
      lineText: '雨が好き',
      takes: 3,
      maybeBestMatch: Option.some(0.9),
      maybeLatestMatch: Option.some(0.9),
      latestAt: nov9 + 2 * dayMs,
      latestDay: '2026-11-11',
    })
  })

  test('count the takes of each day practised, earliest first, and nothing for a day without', () => {
    expect(summarise(entries).days).toEqual([
      { day: '2026-11-09', takes: 2 },
      { day: '2026-11-10', takes: 1 },
      { day: '2026-11-11', takes: 1 },
    ])
  })

  test('name the takes scored by an earlier version of the score', () => {
    expect(summarise(entries).outdatedIds).toEqual(['d'])
  })

  test('find a line’s first, best and latest takes; a tie goes to the newer, and a take not compared is never the best', () => {
    const found = lineTakesOf(
      [
        entryOf({
          id: 'late',
          takenAt: nov9 + 3 * dayMs,
          score: couldNotCompare(),
        }),
        entryOf({ id: 'tie-new', takenAt: nov9 + dayMs, score: scoredAt(0.8) }),
        entryOf({ id: 'first', takenAt: nov9, score: scoredAt(0.8) }),
        entryOf({ id: 'elsewhere', takenAt: nov9, ...other }),
      ],
      'ame-ga-suki',
      '1',
    )
    expect(
      Option.map(found, ({ takes, first, maybeBest, latest }) => ({
        takes: takes.map(take => take.id),
        first: first.id,
        best: Option.map(maybeBest, best => best.id),
        latest: latest.id,
      })),
    ).toEqual(
      Option.some({
        takes: ['first', 'tie-new', 'late'],
        first: 'first',
        best: Option.some('tie-new'),
        latest: 'late',
      }),
    )
    expect(lineTakesOf([], 'ame-ga-suki', '1')).toEqual(Option.none())
  })
})

describe('a line of the learner’s clip whose span changed', () => {
  const clipLine = {
    clipId: 'c1',
    lineId: '4',
    lineText: 'reading.mp3, line 4',
  }
  const takes = [
    entryOf({
      id: 'old-1',
      takenAt: nov9,
      score: scoredAt(0.9),
      nativeId: 'cut',
      ...clipLine,
    }),
    entryOf({
      id: 'old-2',
      takenAt: nov9 + dayMs,
      score: scoredAt(0.95),
      nativeId: 'cut',
      ...clipLine,
    }),
    entryOf({
      id: 'new-1',
      takenAt: nov9 + 2 * dayMs,
      score: scoredAt(0.4),
      nativeId: 'moved',
      ...clipLine,
    }),
  ]
  const now = { _tag: 'Current' as const, maybeNativeId: Option.some('moved') }

  test('keeps its takes before the change apart, and draws only the takes since', () => {
    const found = Option.getOrThrow(lineTakesOf(takes, 'c1', '4', now))
    expect(found.lineNow).toBe('Changed')
    expect(found.takes.map(take => take.id)).toEqual(['new-1'])
    expect(found.earlier.map(take => take.id)).toEqual(['old-1', 'old-2'])
    expect(found.drawnFrom).toBe('Now')
    expect(Option.map(found.maybeBest, best => best.id)).toEqual(
      Option.some('new-1'),
    )
    expect(trendOf(found.takes).map(point => point.maybeMatch)).toEqual([
      Option.some(0.4),
    ])
  })

  test('with no take since, draws the earlier ones, still apart from its trend', () => {
    const found = Option.getOrThrow(
      lineTakesOf(takes.slice(0, 2), 'c1', '4', now),
    )
    expect(found.takes).toEqual([])
    expect(found.drawnFrom).toBe('Earlier')
    expect(found.first.id).toBe('old-1')
    expect(Option.map(found.maybeBest, best => best.id)).toEqual(
      Option.some('old-2'),
    )
  })

  test('a line moved back to where it was copies the same audio again, so its takes join', () => {
    const back = { _tag: 'Current' as const, maybeNativeId: Option.some('cut') }
    const found = Option.getOrThrow(lineTakesOf(takes, 'c1', '4', back))
    expect(found.takes.map(take => take.id)).toEqual(['old-1', 'old-2'])
    expect(found.earlier.map(take => take.id)).toEqual(['new-1'])
  })

  test('a line gone from its clip keeps every take, with nothing apart', () => {
    const found = Option.getOrThrow(
      lineTakesOf(takes, 'c1', '4', { _tag: 'Gone' }),
    )
    expect(found.lineNow).toBe('Gone')
    expect(found.takes).toHaveLength(3)
    expect(found.earlier).toEqual([])
  })
})

describe('the trend', () => {
  const trend = trendOf([
    entryOf({ id: 'a', takenAt: 1, score: scoredAt(0.25) }),
    entryOf({ id: 'b', takenAt: 2, score: scoredAt(0.5) }),
    entryOf({ id: 'c', takenAt: 3, score: couldNotCompare() }),
    entryOf({ id: 'd', takenAt: 4, score: scoredAt(1) }),
  ])

  test('draws each run of compared takes as its own line, from the foot at 0% to the top at 100%', () => {
    expect(trendRuns(trend)).toEqual(['6.0,117.0 202.0,80.0', '594.0,6.0'])
  })

  test('says in words what it shows', () => {
    expect(describeTrend(trend)).toBe(
      'Your match over 4 takes: first 25%, best 100%, latest 100%. 1 take could not be compared.',
    )
    expect(describeTrend(trendOf([]))).toBe('0 takes, none of them compared.')
  })
})

describe('the calendar', () => {
  test('lays a month out in weeks from Monday', () => {
    const weeks = weeksOf(Calendar.make(2026, 11, 1))
    expect(weeks).toHaveLength(6)
    expect(weeks[0]?.map(day => day?.day ?? null)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      1,
    ])
    expect(weeks[5]?.map(day => day?.day ?? null)).toEqual([
      30,
      null,
      null,
      null,
      null,
      null,
      null,
    ])
    expect(weeksOf(Calendar.make(2027, 2, 1))).toHaveLength(4)
  })

  test('sums only the month shown', () => {
    expect(
      monthTotals(
        Calendar.make(2026, 11, 1),
        new Map([
          ['2026-10-31', 4],
          ['2026-11-01', 2],
          ['2026-11-30', 1],
        ]),
      ),
    ).toEqual({ days: 2, takes: 3 })
  })
})

describe('the words', () => {
  test('say a day and a size as people do', () => {
    expect(dayText('2026-11-09')).toBe('9 November 2026')
    expect(bytesText(512)).toBe('512 bytes')
    expect(bytesText(106_496)).toBe('106 kB')
    expect(bytesText(2_340_000)).toBe('2.3 MB')
  })
})
