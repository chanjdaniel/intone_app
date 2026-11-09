import { describe, expect, it } from 'vitest'

import { returnAfterMissDays, returnStepDays } from './constants'
import { type ReturnTake, addDays, isDue, returnOf, returnsOn } from './returns'
import { starThresholds } from './stars'

// A line's returns (report section 5, "Come back"): it comes back for a
// blind take 1, 3, 7, 14 and 30 days after each return that reaches its
// threshold, and a day after one that does not. The clock here is the
// learner's day of each take, so every test says which days pass.

const thresholds = starThresholds()
const reached = 0.8
const missed = 0.5

const blind = (day: string, match: number): ReturnTake => ({
  mode: 'Blind',
  day,
  score: { _tag: 'Scored', match },
})
const guided = (day: string, match: number): ReturnTake => ({
  mode: 'Guided',
  day,
  score: { _tag: 'Scored', match },
})
const blindUncompared = (day: string): ReturnTake => ({
  mode: 'Blind',
  day,
  score: { _tag: 'CouldNotCompare' },
})

// Takes made on the day each one comes due, every one reaching.
const keptUp = (from: string, count: number): ReadonlyArray<ReturnTake> =>
  Array.from({ length: count }).reduce<ReadonlyArray<ReturnTake>>(takes => {
    const due = returnOf(takes, thresholds)?.dueOn ?? from
    return [...takes, blind(due, reached)]
  }, [])

describe('addDays', () => {
  it('counts calendar days across a month, a year and a leap day', () => {
    expect(addDays('2026-11-10', 1)).toBe('2026-11-11')
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01')
    expect(addDays('2026-12-25', 7)).toBe('2027-01-01')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2028-02-29', 30)).toBe('2028-03-30')
  })
})

describe('returnOf', () => {
  it('gives a line none before its first blind take', () => {
    expect(returnOf([], thresholds)).toBeNull()
    expect(
      returnOf(
        [guided('2026-11-10', reached), guided('2026-11-11', 0.95)],
        thresholds,
      ),
    ).toBeNull()
  })

  it('brings a line back the next day after a first blind take, reached or not', () => {
    expect(returnOf([blind('2026-11-10', reached)], thresholds)).toStrictEqual({
      streak: 1,
      setOn: '2026-11-10',
      dueOn: '2026-11-11',
    })
    expect(returnOf([blind('2026-11-10', missed)], thresholds)).toStrictEqual({
      streak: 0,
      setOn: '2026-11-10',
      dueOn: '2026-11-11',
    })
  })

  it('widens the gap 1, 3, 7, 14 and 30 days with each return that reaches, then holds at 30', () => {
    const takes = keptUp('2026-11-10', 7)
    expect(takes.map(take => take.day)).toStrictEqual([
      '2026-11-10',
      '2026-11-11',
      '2026-11-14',
      '2026-11-21',
      '2026-12-05',
      '2027-01-04',
      '2027-02-03',
    ])
    expect(returnOf(takes, thresholds)).toStrictEqual({
      streak: 7,
      setOn: '2027-02-03',
      dueOn: '2027-03-05',
    })
    expect(returnStepDays).toStrictEqual([1, 3, 7, 14, 30])
  })

  it('brings a line back a day after a return that misses, and starts its steps again', () => {
    const takes = [...keptUp('2026-11-10', 4), blind('2026-11-21', missed)]
    expect(returnOf(takes, thresholds)).toStrictEqual({
      streak: 0,
      setOn: '2026-11-21',
      dueOn: addDays('2026-11-21', returnAfterMissDays),
    })
    expect(
      returnOf(
        [...takes, blind('2026-11-22', reached), blind('2026-11-23', reached)],
        thresholds,
      ),
    ).toStrictEqual({ streak: 2, setOn: '2026-11-23', dueOn: '2026-11-26' })
  })

  it('reads a match at the whole percent shown, as stars do', () => {
    expect(returnOf([blind('2026-11-10', 0.746)], thresholds)?.streak).toBe(1)
    expect(returnOf([blind('2026-11-10', 0.744)], thresholds)?.streak).toBe(0)
  })

  it('counts no guided take as a return, however well it went', () => {
    const before = [blind('2026-11-10', reached)]
    expect(
      returnOf([...before, guided('2026-11-11', 0.99)], thresholds),
    ).toStrictEqual(returnOf(before, thresholds))
  })

  it('lets a blind take that could not be compared move nothing', () => {
    const before = keptUp('2026-11-10', 3)
    expect(
      returnOf([...before, blindUncompared('2026-11-21')], thresholds),
    ).toStrictEqual(returnOf(before, thresholds))
    expect(returnOf([blindUncompared('2026-11-10')], thresholds)).toBeNull()
  })

  it('keeps the date a reaching blind take made before it was due, so takes in one sitting do not skip the steps', () => {
    const takes = [
      blind('2026-11-10', reached),
      blind('2026-11-10', reached),
      blind('2026-11-10', 0.95),
    ]
    expect(returnOf(takes, thresholds)).toStrictEqual({
      streak: 1,
      setOn: '2026-11-10',
      dueOn: '2026-11-11',
    })
  })

  it('brings a line back the next day after an early blind take that misses', () => {
    const takes = [...keptUp('2026-11-10', 4), blind('2026-11-25', missed)]
    expect(returnOf(takes, thresholds)).toStrictEqual({
      streak: 0,
      setOn: '2026-11-25',
      dueOn: '2026-11-26',
    })
  })

  it('after a missed week, counts the late return as a return and steps on from the day it was made', () => {
    const before = keptUp('2026-11-10', 3)
    const due = returnOf(before, thresholds)
    expect(due?.dueOn).toBe('2026-11-21')
    const late = '2026-11-28'
    expect(returnsOn(before, late, thresholds)).toStrictEqual({
      streak: 3,
      setOn: '2026-11-14',
      dueOn: '2026-11-21',
      due: true,
    })
    expect(
      returnOf([...before, blind(late, reached)], thresholds),
    ).toStrictEqual({ streak: 4, setOn: late, dueOn: '2026-12-12' })
    expect(
      returnOf([...before, blind(late, missed)], thresholds),
    ).toStrictEqual({ streak: 0, setOn: late, dueOn: '2026-11-29' })
  })
})

describe('isDue', () => {
  const lineReturn = { streak: 2, setOn: '2026-11-11', dueOn: '2026-11-14' }

  it('is due from its day on, however long after, and not before', () => {
    expect(isDue(lineReturn, '2026-11-13')).toBe(false)
    expect(isDue(lineReturn, '2026-11-14')).toBe(true)
    expect(isDue(lineReturn, '2026-11-15')).toBe(true)
    expect(isDue(lineReturn, '2027-06-01')).toBe(true)
  })
})

describe('returnsOn', () => {
  it('says whether a line is due on a day, or has no return at all', () => {
    const takes = [blind('2026-11-10', reached)]
    expect(returnsOn(takes, '2026-11-10', thresholds)?.due).toBe(false)
    expect(returnsOn(takes, '2026-11-11', thresholds)?.due).toBe(true)
    expect(returnsOn([], '2026-11-11', thresholds)).toBeNull()
  })
})
