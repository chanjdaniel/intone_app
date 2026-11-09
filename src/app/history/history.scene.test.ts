import { Option } from 'effect'
import { Calendar } from 'foldkit'
import {
  Command,
  Mount,
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
import { type LineReturn } from '../returns/lineReturn'
import { DrawCurvePair } from '../take/curvePair'
import { TakeScore } from '../take/take'
import { sampleCurve, sampleScore } from '../take/testCurves'
import {
  FocusLineRow,
  LoadHistory,
  ReplaceFind,
  RescoreTakes,
} from './commands'
import {
  type BlindPoint,
  HistoryPage,
  LineHistoryPage,
  type LineNow,
  Rescoring,
  type ShownTake,
  rowsPerPage,
  summarise,
} from './history'
import { entryOf, nov9, scoredAt } from './testEntries'

// The history screens as the learner sees them.

const linesOf = (count: number) =>
  summarise(
    Array.from({ length: count }, (_, k) =>
      entryOf({
        id: `take-${k}`,
        takenAt: nov9 - k * 60_000,
        clipId: 'clip',
        lineId: String(k + 1),
        lineText: `line ${k + 1}`,
        score: scoredAt(0.5 + k / 200),
      }),
    ),
  ).lines

const onHistory = (
  page: Partial<Extract<HistoryPage, { _tag: 'Ready' }>> = {},
  maybeFind: Option.Option<string> = Option.none(),
): Model => ({
  ...initialModel(AppRoute.History({ maybeFind })),
  history: HistoryPage.Ready({
    lines: linesOf(3),
    days: [
      { day: '2026-11-02', takes: 1 },
      { day: '2026-11-09', takes: 2 },
    ],
    today: Calendar.make(2026, 11, 10),
    month: Calendar.make(2026, 11, 1),
    shownRows: rowsPerPage,
    outdatedIds: [],
    unreadable: 0,
    rescoring: Rescoring.Idle(),
    ...page,
  }),
})

const findField = role('searchbox', { name: 'Find a line' })
const rows = all.role('link', { name: /^line \d+/ })

describe('/history', () => {
  test('marks each day practised with its takes, and today, with no word about a day missed', () => {
    scene(
      { update, view },
      given(onHistory()),
      expect(role('heading', { name: 'Your history', level: 1 })).toExist(),
      expect(text('November 2026')).toExist(),
      expect(text('2 days practised, 3 takes')).toExist(),
      expect(text('9 November: 2 takes')).toExist(),
      expect(text('2 November: 1 take')).toExist(),
      expect(text('10 November, today: no takes')).toExist(),
      expect(text(/streak|missed|broke|lost/i)).toBeAbsent(),
      expect(role('button', { name: 'Show December 2026' })).toBeDisabled(),
      expect(role('button', { name: 'Show October 2026' })).toBeDisabled(),
    )
  })

  test('lists the lines practised, each with its takes, best match and last day, opening its history', () => {
    scene(
      { update, view },
      given(onHistory()),
      expect(text('3 lines practised')).toExist(),
      expect(
        role('link', {
          name: /^line 1, 1 take · best 50% · last 9 November 2026/,
        }),
      ).toHaveAttr('href', '/history/clip/1'),
      expect(findField).toBeAbsent(),
    )
  })

  test('a long list finds by the words in the address, shows 50 rows and offers the rest', () => {
    scene(
      { update, view },
      given(onHistory({ lines: linesOf(60) })),
      expect(findField).toExist(),
      expect(text('60 lines practised')).toExist(),
      expectAll(rows).toHaveCount(50),
      expect(role('button', { name: 'Show 10 more' })).toExist(),
      click(role('button', { name: 'Show 10 more' })),
      Command.resolve(FocusLineRow, Message.CompletedFocusLineRow()),
      expectAll(rows).toHaveCount(60),
      expect(role('button', { name: /Show \d+ more/ })).toBeAbsent(),
      type(findField, 'line 5'),
      Command.expectExact(ReplaceFind({ words: 'line 5' })),
      Command.resolve(ReplaceFind, Message.CompletedReplaceFind()),
    )
    scene(
      { update, view },
      given(onHistory({ lines: linesOf(60) }, Option.some(' line 6 '))),
      expect(findField).toHaveValue(' line 6 '),
      expect(text('2 lines of 60 found for “line 6”')).toExist(),
      expectAll(rows).toHaveCount(2),
    )
  })

  test('offers to score again the takes an earlier score version scored, and says how far it has got', () => {
    scene(
      { update, view },
      given(onHistory({ outdatedIds: ['a', 'b'] })),
      expect(
        text(/^2 takes were scored by an earlier version of the score/),
      ).toExist(),
      click(role('button', { name: 'Score 2 takes again' })),
      expect(text('Scoring again: 0 of 2 takes.')).toExist(),
      expect(role('button', { name: /^Score .* again$/ })).toBeAbsent(),
      Command.resolve(
        RescoreTakes,
        Message.SucceededRescoreTakes({ rescored: 2 }),
      ),
      Command.resolve(
        LoadHistory,
        Message.FailedLoadHistory({ reason: 'gone' }),
      ),
      expect(
        text('2 takes scored again with the score as it is now.'),
      ).toExist(),
    )
  })

  test('says when nothing is kept yet, and where to start', () => {
    scene(
      { update, view },
      given(onHistory({ lines: [], days: [] })),
      expect(text(/^No takes yet\./)).toExist(),
      expect(role('link', { name: 'Choose a line to copy' })).toHaveAttr(
        'href',
        '/',
      ),
    )
  })

  test('says so while it reads, and when it cannot', () => {
    scene(
      { update, view },
      given({
        ...initialModel(AppRoute.History({ maybeFind: Option.none() })),
        history: HistoryPage.Failed({ reason: 'The disk is gone.' }),
      }),
      expect(role('alert')).toHaveText(
        'Your history could not be read. The disk is gone.',
      ),
    )
  })
})

const shown = (id: string, day: string, score: TakeScore): ShownTake => ({
  id,
  takenAt: nov9,
  day,
  score,
  curve: sampleCurve,
  native: sampleCurve,
})

describe('a line’s history', () => {
  const drawn = Mount.resolve(DrawCurvePair, Message.CompletedDrawCurvePair())

  const withBlind = (
    blindTrend: ReadonlyArray<BlindPoint>,
    maybeReturn: Option.Option<LineReturn>,
    lineNow: LineNow = 'AsTaken',
  ): Model => {
    const latest = shown('latest', '2026-11-09', sampleScore)
    return {
      ...initialModel(
        AppRoute.LineHistory({ clipId: 'ame-ga-suki', lineId: '1' }),
      ),
      lineHistory: LineHistoryPage.Ready({
        clipId: 'ame-ga-suki',
        lineId: '1',
        lineText: '雨が好き',
        lineNow,
        trend: [{ takenAt: 2, maybeMatch: Option.some(0.824), version: 1 }],
        earlierTrend: [],
        blindTrend,
        maybeReturn,
        today: '2026-11-12',
        drawnFrom: 'Now',
        first: latest,
        maybeBest: Option.some(latest),
        latest,
      }),
    }
  }

  test('charts the line’s blind takes over time with the threshold, summed up for a screen reader, and says when it comes back', () => {
    scene(
      { update, view },
      given(
        withBlind(
          [
            { takenAt: 1, day: '2026-11-03', maybeMatch: Option.some(0.7) },
            { takenAt: 2, day: '2026-11-04', maybeMatch: Option.some(0.8) },
            { takenAt: 3, day: '2026-11-07', maybeMatch: Option.some(0.77) },
          ],
          Option.some({ streak: 2, setOn: '2026-11-07', dueOn: '2026-11-14' }),
        ),
      ),
      drawn,
      expect(
        role('heading', { name: 'Your blind takes over time', level: 2 }),
      ).toExist(),
      expect(
        role('img', {
          name: 'Your blind takes of this line: 3 takes from 3 November 2026 to 7 November 2026: first 70%, latest 77%, best 80%. 2 of 3 reached the threshold of 75%.',
        }),
      ).toExist(),
      expect(
        text('Comes back for a blind take on 14 November 2026.'),
      ).toExist(),
    )
    scene(
      { update, view },
      given(
        withBlind(
          [{ takenAt: 1, day: '2026-11-03', maybeMatch: Option.some(0.5) }],
          Option.some({ streak: 0, setOn: '2026-11-03', dueOn: '2026-11-04' }),
        ),
      ),
      drawn,
      expect(text('Due back today for a blind take.')).toExist(),
      expect(text(/\b(overdue|late|missed)\b/i)).toBeAbsent(),
    )
  })

  test('says a line with no blind take yet has none to chart', () => {
    scene(
      { update, view },
      given(withBlind([], Option.none())),
      drawn,
      expect(
        text(
          'No blind takes of this line yet. A blind take hides the curves until it ends, and shows here whether the line has held.',
        ),
      ).toExist(),
      expect(role('img', { name: /^Your blind takes/ })).toBeAbsent(),
    )
  })

  test('draws the first, best and latest takes over the line, each with its score’s version, and the trend', () => {
    const first = shown(
      'first',
      '2026-11-02',
      TakeScore.CouldNotCompare({ version: 0, reason: 'LengthMismatch' }),
    )
    const latest = shown('latest', '2026-11-09', sampleScore)
    scene(
      { update, view },
      given({
        ...initialModel(
          AppRoute.LineHistory({ clipId: 'ame-ga-suki', lineId: '1' }),
        ),
        lineHistory: LineHistoryPage.Ready({
          clipId: 'ame-ga-suki',
          lineId: '1',
          lineText: '雨が好き',
          lineNow: 'AsTaken',
          trend: [
            { takenAt: 1, maybeMatch: Option.none(), version: 0 },
            { takenAt: 2, maybeMatch: Option.some(0.824), version: 1 },
          ],
          earlierTrend: [],
          blindTrend: [],
          maybeReturn: Option.none(),
          today: '2026-11-10',
          drawnFrom: 'Now',
          first,
          maybeBest: Option.some(latest),
          latest,
        }),
      }),
      drawn,
      drawn,
      expect(role('heading', { name: '雨が好き', level: 1 })).toExist(),
      expect(text('2 takes since 2 November 2026')).toExist(),
      expect(role('link', { name: 'Practise this line' })).toHaveAttr(
        'href',
        '/line/ame-ga-suki/1',
      ),
      expect(
        role('img', {
          name: 'Your match over 2 takes: first 82%, best 82%, latest 82%. 1 take could not be compared.',
        }),
      ).toExist(),
      expect(role('heading', { name: 'First take', level: 3 })).toExist(),
      expect(
        text("Your take was too far from the line's length to compare"),
      ).toExist(),
      expect(
        text(
          'Scored by version 0 of the score, an earlier one than today’s 1.',
        ),
      ).toExist(),
      expect(
        role('heading', { name: 'Best and latest take', level: 3 }),
      ).toExist(),
      expect(text('82% match to this clip')).toExist(),
      expect(text('Scored by version 1 of the score.')).toExist(),
      expectAll(
        all.role('img', { name: /^The line's pitch curve/ }),
      ).toHaveCount(2),
    )
  })

  test('keeps the takes of a changed line’s earlier span apart from its match over time', () => {
    const latest = shown('latest', '2026-11-09', sampleScore)
    scene(
      { update, view },
      given({
        ...initialModel(AppRoute.LineHistory({ clipId: 'c1', lineId: '4' })),
        lineHistory: LineHistoryPage.Ready({
          clipId: 'c1',
          lineId: '4',
          lineText: 'reading.mp3, line 4',
          lineNow: 'Changed',
          trend: [{ takenAt: 3, maybeMatch: Option.some(0.824), version: 1 }],
          earlierTrend: [
            { takenAt: 1, maybeMatch: Option.some(0.5), version: 1 },
            { takenAt: 2, maybeMatch: Option.some(0.6), version: 1 },
          ],
          blindTrend: [],
          maybeReturn: Option.none(),
          today: '2026-11-10',
          drawnFrom: 'Now',
          first: latest,
          maybeBest: Option.some(latest),
          latest,
        }),
      }),
      drawn,
      expect(text('1 take since 9 November 2026')).toExist(),
      expect(
        role('img', {
          name: 'Your match over 1 take: first 82%, best 82%, latest 82%.',
        }),
      ).toExist(),
      expect(
        role('heading', {
          name: 'Taken against its earlier start or end',
          level: 2,
        }),
      ).toExist(),
      expect(
        text(
          '2 takes copied the line before its start or end was changed. They are kept, and shown apart from its match over time, since they copied a different stretch of the clip.',
        ),
      ).toExist(),
      expect(
        role('img', {
          name: 'Your match over 2 takes: first 50%, best 60%, latest 60%.',
        }),
      ).toExist(),
    )
  })

  test('a line just changed draws its earlier takes, and one gone from its clip says so', () => {
    const latest = shown('latest', '2026-11-09', sampleScore)
    const ready = (lineNow: 'Changed' | 'Gone') =>
      LineHistoryPage.Ready({
        clipId: 'c1',
        lineId: '4',
        lineText: 'reading.mp3, line 4',
        lineNow,
        trend:
          lineNow === 'Gone'
            ? [{ takenAt: 3, maybeMatch: Option.some(0.824), version: 1 }]
            : [],
        earlierTrend:
          lineNow === 'Gone'
            ? []
            : [{ takenAt: 3, maybeMatch: Option.some(0.824), version: 1 }],
        blindTrend: [],
        maybeReturn: Option.none(),
        today: '2026-11-10',
        drawnFrom: lineNow === 'Gone' ? 'Now' : 'Earlier',
        first: latest,
        maybeBest: Option.some(latest),
        latest,
      })
    scene(
      { update, view },
      given({
        ...initialModel(AppRoute.LineHistory({ clipId: 'c1', lineId: '4' })),
        lineHistory: ready('Changed'),
      }),
      drawn,
      expect(text('No takes yet of the line as it is now')).toExist(),
      expect(role('heading', { name: 'Your match over time' })).not.toExist(),
      expect(
        role('heading', { name: 'Your takes over its earlier start or end' }),
      ).toExist(),
    )
    scene(
      { update, view },
      given({
        ...initialModel(AppRoute.LineHistory({ clipId: 'c1', lineId: '4' })),
        lineHistory: ready('Gone'),
      }),
      drawn,
      expect(
        text(
          'This line is no longer in its clip: it was deleted, or merged into another line. Your takes of it are kept here.',
        ),
      ).toExist(),
      expect(role('link', { name: 'Practise this line' })).not.toExist(),
    )
  })

  test('says so when no take of the line is kept', () => {
    scene(
      { update, view },
      given({
        ...initialModel(
          AppRoute.LineHistory({ clipId: 'ame-ga-suki', lineId: '1' }),
        ),
        lineHistory: LineHistoryPage.Empty({
          clipId: 'ame-ga-suki',
          lineId: '1',
        }),
      }),
      expect(text('No takes of this line are kept on this device.')).toExist(),
      expect(role('link', { name: 'Practise this line' })).toExist(),
    )
  })
})
