import { Option } from 'effect'
import { Calendar } from 'foldkit'
import { Command, given, message, model, story } from 'foldkit/story'
import { fromString } from 'foldkit/url'
import { describe, expect, test } from 'vitest'

import {
  AppRoute,
  Message,
  type Model,
  init,
  initialModel,
  update,
} from '../main'
import { LoadTextChoice } from '../text/commands'
import {
  FocusLineRow,
  LoadHistory,
  LoadLineHistory,
  ReplaceFind,
  RescoreTakes,
} from './commands'
import {
  HistoryPage,
  LineHistoryPage,
  Rescoring,
  rowsPerPage,
  summarise,
} from './history'
import { entryOf, nov9 } from './testEntries'

const url = (path: string) =>
  Option.getOrThrow(fromString(`http://localhost${path}`))

const history = AppRoute.History({ maybeFind: Option.none() })

const loaded = (
  days: ReadonlyArray<string>,
  outdatedIds: ReadonlyArray<string> = [],
) =>
  Message.SucceededLoadHistory({
    lines: summarise([entryOf({ id: 'a', takenAt: nov9 })]).lines,
    days: days.map(day => ({ day, takes: 1 })),
    today: Calendar.make(2026, 11, 10),
    outdatedIds,
    unreadable: 0,
  })

const ready = (
  overrides: Partial<Extract<HistoryPage, { _tag: 'Ready' }>> = {},
): Model => ({
  ...initialModel(history),
  history: HistoryPage.Ready({
    lines: [],
    days: [{ day: '2026-09-20', takes: 2 }],
    today: Calendar.make(2026, 11, 10),
    month: Calendar.make(2026, 11, 1),
    shownRows: rowsPerPage,
    outdatedIds: [],
    unreadable: 0,
    rescoring: Rescoring.Idle(),
    ...overrides,
  }),
})

const readyPage = (current: Model) => {
  if (current.history._tag !== 'Ready') {
    throw new Error(`history is ${current.history._tag}`)
  }
  return current.history
}

describe('/history', () => {
  test('reads the history when it opens, and shows the month of the latest day practised', () => {
    const start = init(url('/history'))
    expect(start.model.history).toStrictEqual(HistoryPage.Loading())
    expect(start.commands).toStrictEqual([LoadHistory(), LoadTextChoice()])
    story(
      update,
      given(start.model),
      message(loaded(['2026-09-20', '2026-10-02'])),
      model(current => {
        expect(readyPage(current).month).toStrictEqual(
          Calendar.make(2026, 10, 1),
        )
        expect(readyPage(current).shownRows).toBe(rowsPerPage)
      }),
    )
  })

  test('shows this month when nothing has been practised', () => {
    story(
      update,
      given(init(url('/history')).model),
      message(loaded([])),
      model(current => {
        expect(readyPage(current).month).toStrictEqual(
          Calendar.make(2026, 11, 1),
        )
      }),
    )
  })

  test('says why when the history cannot be read', () => {
    story(
      update,
      given(init(url('/history')).model),
      message(Message.FailedLoadHistory({ reason: 'Disk gone.' })),
      model(current => {
        expect(current.history).toStrictEqual(
          HistoryPage.Failed({ reason: 'Disk gone.' }),
        )
      }),
    )
  })

  test('moves a month at a time, never past this month', () => {
    story(
      update,
      given(ready()),
      message(Message.ClickedNextMonth()),
      model(current => {
        expect(readyPage(current).month).toStrictEqual(
          Calendar.make(2026, 11, 1),
        )
      }),
      message(Message.ClickedPreviousMonth()),
      message(Message.ClickedPreviousMonth()),
      model(current => {
        expect(readyPage(current).month).toStrictEqual(
          Calendar.make(2026, 9, 1),
        )
      }),
      message(Message.ClickedNextMonth()),
      model(current => {
        expect(readyPage(current).month).toStrictEqual(
          Calendar.make(2026, 10, 1),
        )
      }),
    )
  })

  test('writes the find words to the address, and shows one page of what they find', () => {
    story(
      update,
      given(ready({ shownRows: 3 * rowsPerPage })),
      message(Message.ChangedFindLines({ words: '雨 ' })),
      Command.expectExact(ReplaceFind({ words: '雨 ' })),
      Command.resolve(ReplaceFind, Message.CompletedReplaceFind()),
      message(Message.ChangedUrl({ url: url('/history?find=%E9%9B%A8+') })),
      model(current => {
        expect(current.route).toStrictEqual(
          AppRoute.History({ maybeFind: Option.some('雨 ') }),
        )
        expect(readyPage(current).shownRows).toBe(rowsPerPage)
        expect(current.history._tag).toBe('Ready')
      }),
    )
  })

  test('shows the next page of lines, and puts focus on its first row', () => {
    story(
      update,
      given(ready()),
      message(Message.ClickedShowMoreLines()),
      Command.expectExact(FocusLineRow({ index: rowsPerPage })),
      model(current => {
        expect(readyPage(current).shownRows).toBe(2 * rowsPerPage)
      }),
      Command.resolve(FocusLineRow, Message.CompletedFocusLineRow()),
    )
  })

  test('scores the takes of an earlier score version again, a batch at a time, then reads the history again', () => {
    const outdatedIds = Array.from({ length: 45 }, (_, k) => `old-${k}`)
    story(
      update,
      given(ready({ outdatedIds })),
      message(Message.ClickedRescore()),
      Command.expectExact(RescoreTakes({ ids: outdatedIds.slice(0, 20) })),
      model(current => {
        expect(readyPage(current).rescoring).toStrictEqual(
          Rescoring.Running({
            total: 45,
            done: 0,
            remainingIds: outdatedIds.slice(20),
          }),
        )
      }),
      Command.resolve(
        RescoreTakes,
        Message.SucceededRescoreTakes({ rescored: 20 }),
      ),
      Command.expectExact(RescoreTakes({ ids: outdatedIds.slice(20, 40) })),
      Command.resolve(
        RescoreTakes,
        Message.SucceededRescoreTakes({ rescored: 20 }),
      ),
      Command.expectExact(RescoreTakes({ ids: outdatedIds.slice(40) })),
      Command.resolve(
        RescoreTakes,
        Message.SucceededRescoreTakes({ rescored: 4 }),
      ),
      Command.expectExact(LoadHistory()),
      model(current => {
        expect(readyPage(current).rescoring).toStrictEqual(
          Rescoring.Done({ rescored: 44 }),
        )
      }),
      Command.resolve(LoadHistory, loaded(['2026-11-09'])),
      model(current => {
        expect(readyPage(current).outdatedIds).toStrictEqual([])
        expect(readyPage(current).rescoring).toStrictEqual(
          Rescoring.Done({ rescored: 44 }),
        )
      }),
    )
  })

  test('starts no second rescoring while one runs', () => {
    story(
      update,
      given(
        ready({
          outdatedIds: ['a'],
          rescoring: Rescoring.Running({ total: 1, done: 0, remainingIds: [] }),
        }),
      ),
      message(Message.ClickedRescore()),
      Command.expectNone(),
    )
  })
})

describe('a line’s history', () => {
  const line = AppRoute.LineHistory({ clipId: 'ame-ga-suki', lineId: '1' })

  test('reads the line’s takes when it opens', () => {
    const start = init(url('/history/ame-ga-suki/1'))
    expect(start.model.route).toStrictEqual(line)
    expect(start.model.lineHistory).toStrictEqual(
      LineHistoryPage.Loading({ clipId: 'ame-ga-suki', lineId: '1' }),
    )
    expect(start.commands).toMatchObject([
      {
        name: LoadLineHistory.name,
        args: { clipId: 'ame-ga-suki', lineId: '1' },
      },
      { name: LoadTextChoice.name },
    ])
  })

  test('says so when no take of the line is kept, and ignores an answer for another line', () => {
    story(
      update,
      given(init(url('/history/ame-ga-suki/1')).model),
      message(
        Message.SucceededLoadLineHistory({
          clipId: 'kaze',
          lineId: '1',
          maybeFound: Option.none(),
        }),
      ),
      model(current => {
        expect(current.lineHistory._tag).toBe('Loading')
      }),
      message(
        Message.SucceededLoadLineHistory({
          clipId: 'ame-ga-suki',
          lineId: '1',
          maybeFound: Option.none(),
        }),
      ),
      model(current => {
        expect(current.lineHistory).toStrictEqual(
          LineHistoryPage.Empty({ clipId: 'ame-ga-suki', lineId: '1' }),
        )
      }),
    )
  })
})
