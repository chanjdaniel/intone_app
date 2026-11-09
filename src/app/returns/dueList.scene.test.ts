import { Option } from 'effect'
import {
  Command,
  all,
  click,
  expect,
  expectAll,
  given,
  role,
  scene,
  text,
  type,
} from 'foldkit/scene'
import { describe, test } from 'vitest'

import {
  AppRoute,
  Message,
  type Model,
  initialModel,
  update,
  view,
} from '../main'
import { FocusDueRow, ReplaceDueFind } from './commands'
import { type DueLine, DuePage, dueRowsPerPage } from './returns'

// The home screen's lines due back, as the learner sees them.

const dueLine = (k: number, dueOn = '2026-11-10'): DueLine => ({
  clipId: 'c1',
  lineId: String(k),
  title: `Line ${k}`,
  titleIsText: false,
  levelName: 'A walk',
  number: k,
  stars: 1,
  lineReturn: { streak: 0, setOn: '2026-11-03', dueOn },
})

const onHome = (
  lines: ReadonlyArray<DueLine>,
  maybeNextOn: Option.Option<string> = Option.none(),
  maybeFind: Option.Option<string> = Option.none(),
): Model => ({
  ...initialModel(AppRoute.Home({ maybeFind })),
  due: DuePage.Ready({
    today: '2026-11-10',
    lines,
    maybeNextOn,
    shownRows: dueRowsPerPage,
  }),
})

const section = role('region', { name: 'Back for a blind take' })
const findField = role('searchbox', { name: 'Find a line due back' })
const rows = all.role('link', { name: /^Line \d+, A walk/ })

describe('the lines due back on the home screen', () => {
  test('say plainly when none are due, and when the next comes back', () => {
    scene(
      { update, view },
      given(onHome([], Option.some('2026-11-14'))),
      expect(section).toExist(),
      expect(
        text(
          'No lines are due back today. The next comes back on 14 November 2026.',
        ),
      ).toExist(),
      expect(
        text(
          'Lines come back 1, 3, 7, 14 and 30 days after each blind take of 75% or more, and the next day after one under it.',
        ),
      ).toExist(),
    )
    scene(
      { update, view },
      given(onHome([])),
      expect(
        text(
          'No lines are due back today. A line you take blind comes back here on a later day, for another blind take.',
        ),
      ).toExist(),
    )
  })

  test('list each line due, with its level, last blind take and stars, opening its practice screen', () => {
    scene(
      { update, view },
      given(onHome([dueLine(1, '2026-11-01'), dueLine(2)])),
      expect(text('2 lines due back today')).toExist(),
      expect(
        role('link', {
          name: /^Line 1, A walk · last blind take 3 November 2026/,
        }),
      ).toHaveAttr('href', '/line/c1/1'),
      expect(role('img', { name: '1 of 3 stars' })).toExist(),
      expect(findField).toBeAbsent(),
      expect(text(/\b(overdue|late|missed|lost)\b/i)).toBeAbsent(),
    )
  })

  test('in the large-list frame past 12, find by the words in the address, show 50 and offer the rest', () => {
    const many = Array.from({ length: 60 }, (_, k) => dueLine(k + 1))
    scene(
      { update, view },
      given(onHome(Array.from({ length: 12 }, (_, k) => dueLine(k + 1)))),
      expect(findField).toBeAbsent(),
    )
    scene(
      { update, view },
      given(onHome(many)),
      expect(findField).toExist(),
      expect(text('60 lines due back today')).toExist(),
      expectAll(rows).toHaveCount(50),
      click(role('button', { name: 'Show 10 more' })),
      Command.resolve(FocusDueRow, Message.CompletedFocusDueRow()),
      expectAll(rows).toHaveCount(60),
      type(findField, 'Line 5'),
      Command.expectExact(ReplaceDueFind({ words: 'Line 5' })),
      Command.resolve(ReplaceDueFind, Message.CompletedReplaceDueFind()),
    )
    scene(
      { update, view },
      given(onHome(many, Option.none(), Option.some(' line 6 '))),
      expect(findField).toHaveValue(' line 6 '),
      expect(text('2 lines of 60 found for “line 6”')).toExist(),
      expectAll(rows).toHaveCount(2),
    )
  })

  test('say why when they could not be read', () => {
    scene(
      { update, view },
      given({
        ...initialModel(AppRoute.Home({ maybeFind: Option.none() })),
        due: DuePage.Failed({ reason: 'The disk is busy.' }),
      }),
      expect(role('alert')).toHaveText(
        'The lines due back could not be read. The disk is busy.',
      ),
    )
  })
})
