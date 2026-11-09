import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { fromString } from 'foldkit/url'
import { describe, expect, test } from 'vitest'

import { LoadClips } from '../level/commands'
import { AppRoute, Message, type Model, initialModel, update } from '../main'
import { FocusDueRow, LoadDueLines, ReplaceDueFind } from './commands'
import { type DueLine, DuePage, dueRowsPerPage } from './returns'

// The home screen's lines due back: read each time home opens, a page at
// a time, found by the words in the address.

const url = (path: string) =>
  Option.getOrThrow(fromString(`http://localhost${path}`))

const home = AppRoute.Home({ maybeFind: Option.none() })

const dueLine = (lineId: string): DueLine => ({
  clipId: 'c1',
  lineId,
  title: `Line ${lineId}`,
  titleIsText: false,
  levelName: 'A walk',
  number: Number(lineId),
  stars: 3,
  lineReturn: { streak: 1, setOn: '2026-11-09', dueOn: '2026-11-10' },
})

const linesOf = (count: number) =>
  Array.from({ length: count }, (_, k) => dueLine(String(k + 1)))

const loaded = (lines: ReadonlyArray<DueLine>) =>
  Message.SucceededLoadDueLines({
    today: '2026-11-10',
    lines,
    maybeNextOn: Option.none(),
  })

const ready = (lines: ReadonlyArray<DueLine>, shownRows = dueRowsPerPage) =>
  DuePage.Ready({
    today: '2026-11-10',
    lines,
    maybeNextOn: Option.none(),
    shownRows,
  })

const onHome = (due: DuePage = ready(linesOf(60))): Model => ({
  ...initialModel(home),
  due,
})

const shownOf = (state: Model): number =>
  state.due._tag === 'Ready' ? state.due.shownRows : 0

describe('the lines due back', () => {
  test('are read when home opens, and again each time it opens', () => {
    story(
      update,
      given(initialModel(AppRoute.Settings())),
      message(Message.ChangedUrl({ url: url('/') })),
      Command.expectExact(LoadClips(), LoadDueLines()),
      model(state => expect(state.due).toStrictEqual(DuePage.Loading())),
      Command.resolve(LoadClips, Message.SucceededLoadClips({ clips: [] })),
      Command.resolve(LoadDueLines, loaded(linesOf(2))),
      model(state => expect(state.due).toStrictEqual(ready(linesOf(2)))),
    )
  })

  test('keep the rows shown when a re-read finds the same lines, and go back to one page when it finds others', () => {
    story(
      update,
      given(onHome(ready(linesOf(120), 2 * dueRowsPerPage))),
      message(Message.ChangedUrl({ url: url('/upload') })),
      message(Message.ChangedUrl({ url: url('/') })),
      Command.resolve(LoadClips, Message.SucceededLoadClips({ clips: [] })),
      Command.resolve(LoadDueLines, loaded(linesOf(120))),
      model(state => expect(shownOf(state)).toBe(2 * dueRowsPerPage)),
      message(Message.ChangedUrl({ url: url('/upload') })),
      message(Message.ChangedUrl({ url: url('/') })),
      Command.resolve(LoadClips, Message.SucceededLoadClips({ clips: [] })),
      Command.resolve(LoadDueLines, loaded(linesOf(119))),
      model(state => expect(shownOf(state)).toBe(dueRowsPerPage)),
    )
  })

  test('say why when they cannot be read', () => {
    story(
      update,
      given(onHome(DuePage.Loading())),
      message(Message.FailedLoadDueLines({ reason: 'The disk is busy.' })),
      model(state =>
        expect(state.due).toStrictEqual(
          DuePage.Failed({ reason: 'The disk is busy.' }),
        ),
      ),
    )
  })

  test('write the find words to the address, and show one page of what they find', () => {
    story(
      update,
      given(onHome(ready(linesOf(120), 2 * dueRowsPerPage))),
      message(Message.ChangedFindDueLines({ words: 'walk ' })),
      Command.expectExact(ReplaceDueFind({ words: 'walk ' })),
      Command.resolve(ReplaceDueFind, Message.CompletedReplaceDueFind()),
      message(Message.ChangedUrl({ url: url('/?find=walk+') })),
      model(state => {
        expect(state.route).toStrictEqual(
          AppRoute.Home({ maybeFind: Option.some('walk ') }),
        )
        expect(shownOf(state)).toBe(dueRowsPerPage)
      }),
    )
  })

  test('show the next page, and put focus on its first row', () => {
    story(
      update,
      given(onHome()),
      message(Message.ClickedShowMoreDueLines()),
      Command.expectExact(FocusDueRow({ index: dueRowsPerPage })),
      model(state => expect(shownOf(state)).toBe(2 * dueRowsPerPage)),
      Command.resolve(FocusDueRow, Message.CompletedFocusDueRow()),
    )
  })
})
