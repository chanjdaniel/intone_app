import { Option } from 'effect'
import { describe, expect, test } from 'vitest'

import { LineAsKept, lineReturnOf } from '../history/history'
import {
  couldNotCompare,
  dayMs,
  entryOf,
  nov9,
  scoredAt,
} from '../history/testEntries'
import type { LevelSource } from '../level/commands'
import { dueLinesFound, dueLinesOf } from './returns'

// The lines due back on the learner's day, worked out from the blind
// takes kept on the device, the way a level's stars are.

const line = (
  lineId: string,
  overrides: Partial<LevelSource['lines'][number]> = {},
): LevelSource['lines'][number] => ({
  lineId,
  title: `雨が好き ${lineId}`,
  titleIsText: true,
  copyable: true,
  asKept: LineAsKept.Bundled(),
  ...overrides,
})

const sources = [
  {
    clipId: 'ame-ga-suki',
    source: { name: 'Starter', lines: [line('1'), line('2'), line('3')] },
  },
  {
    clipId: 'c1',
    source: {
      name: 'A walk',
      lines: [
        line('l1', {
          title: 'Line 1',
          titleIsText: false,
          asKept: LineAsKept.Current({ maybeNativeId: Option.some('n-now') }),
        }),
        line('l2', { title: 'Line 2', titleIsText: false, copyable: false }),
      ],
    },
  },
]

const blindAt = (
  id: string,
  takenAt: number,
  match: number,
  more: Partial<Parameters<typeof entryOf>[0]> = {},
) => entryOf({ id, takenAt, mode: 'Blind', score: scoredAt(match), ...more })

const today = '2026-11-12'

describe('the lines due back', () => {
  test('are none with no blind take, and say no next day', () => {
    const entries = [entryOf({ id: 'a', takenAt: nov9, score: scoredAt(0.9) })]
    expect(dueLinesOf(entries, sources, today)).toStrictEqual({
      due: [],
      maybeNextOn: Option.none(),
    })
  })

  test('list each line due by its last blind take, longest due first, with its stars', () => {
    const entries = [
      blindAt('a', nov9, 0.8),
      entryOf({ id: 'b', takenAt: nov9 + dayMs, lineId: '2' }),
      blindAt('c', nov9 + 2 * dayMs, 0.5, { lineId: '2' }),
      blindAt('d', nov9 + 3 * dayMs, 0.8, { lineId: '3' }),
    ]
    const { due, maybeNextOn } = dueLinesOf(entries, sources, today)
    expect(due.map(found => [found.lineId, found.lineReturn.dueOn])).toEqual([
      ['1', '2026-11-10'],
      ['2', '2026-11-12'],
    ])
    expect(due[0]).toMatchObject({
      clipId: 'ame-ga-suki',
      title: '雨が好き 1',
      titleIsText: true,
      levelName: 'Starter',
      number: 1,
      stars: 3,
    })
    expect(maybeNextOn).toStrictEqual(Option.some('2026-11-13'))
  })

  test('count a guided take on a due line as no return', () => {
    const entries = [
      blindAt('a', nov9, 0.8),
      entryOf({ id: 'b', takenAt: nov9 + 2 * dayMs, score: scoredAt(0.99) }),
    ]
    expect(
      dueLinesOf(entries, sources, today).due.map(found => found.lineId),
    ).toEqual(['1'])
  })

  test('are left by a return made today until its next day', () => {
    const entries = [
      blindAt('a', nov9, 0.8),
      blindAt('b', nov9 + 3 * dayMs, 0.8),
    ]
    expect(dueLinesOf(entries, sources, today)).toStrictEqual({
      due: [],
      maybeNextOn: Option.some('2026-11-15'),
    })
  })

  test('leave out a line that cannot be copied here, and one whose span changed since its blind takes', () => {
    const entries = [
      blindAt('a', nov9, 0.8, {
        clipId: 'c1',
        lineId: 'l1',
        nativeId: 'n-old',
      }),
      blindAt('b', nov9, 0.8, { clipId: 'c1', lineId: 'l2' }),
      blindAt('c', nov9, 0.8, { clipId: 'gone', lineId: 'x' }),
    ]
    expect(dueLinesOf(entries, sources, today).due).toEqual([])
    const now = [
      ...entries,
      blindAt('d', nov9, 0.8, {
        clipId: 'c1',
        lineId: 'l1',
        nativeId: 'n-now',
      }),
    ]
    expect(
      dueLinesOf(now, sources, today).due.map(found => found.lineId),
    ).toEqual(['l1'])
  })

  test('are found by their title or level', () => {
    const entries = [
      blindAt('a', nov9, 0.8),
      blindAt('b', nov9, 0.8, {
        clipId: 'c1',
        lineId: 'l1',
        nativeId: 'n-now',
      }),
    ]
    const { due } = dueLinesOf(entries, sources, today)
    expect(dueLinesFound(due, '  walk ').map(found => found.lineId)).toEqual([
      'l1',
    ])
    expect(dueLinesFound(due, '雨').map(found => found.lineId)).toEqual(['1'])
    expect(dueLinesFound(due, '')).toHaveLength(2)
  })
})

describe('a line’s next return', () => {
  test('ignores a blind take that could not be compared', () => {
    const entries = [
      blindAt('a', nov9, 0.8),
      entryOf({
        id: 'b',
        takenAt: nov9 + dayMs,
        mode: 'Blind',
        score: couldNotCompare(),
      }),
    ]
    expect(
      lineReturnOf(entries, 'ame-ga-suki', '1', LineAsKept.Bundled()),
    ).toStrictEqual(
      Option.some({ streak: 1, setOn: '2026-11-09', dueOn: '2026-11-10' }),
    )
  })

  test('moves with a take scored again', () => {
    const rescored = [blindAt('a', nov9, 0.8, { score: scoredAt(0.6, 2) })]
    expect(
      Option.map(
        lineReturnOf(rescored, 'ame-ga-suki', '1', LineAsKept.Bundled()),
        found => found.streak,
      ),
    ).toStrictEqual(Option.some(0))
  })
})
