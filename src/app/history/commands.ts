import { Array, Effect, Option, Schema } from 'effect'
import { Calendar, Command, Dom } from 'foldkit'
import { replaceUrl } from 'foldkit/navigation'

import { type TakeEntry, scoreOfStored } from '../../services/history-records'
import {
  type FullTake,
  HistoryError,
  HistoryStore,
} from '../../services/history-store'
import { Scorer } from '../../services/scorer'
import { clipLineTitle, lineOf } from '../line/lines'
import { Message } from '../message'
import { historyRouter } from '../route'
import { takeCurveOf, takeScoreOf } from '../take/take'
import {
  type LineAsKept,
  type ShownTake,
  lineTakesOf,
  summarise,
  trendOf,
} from './history'

// Reads the history from the device for /history: the lines practised
// and the days, summed up, and today, for the calendar.
export const LoadHistory = Command.define('LoadHistory', {
  messages: [Message.SucceededLoadHistory, Message.FailedLoadHistory],
  execute: Effect.gen(function* () {
    const history = yield* HistoryStore
    const { entries, unreadable } = yield* history.entries
    const today = yield* Calendar.today.local
    return Message.SucceededLoadHistory({
      ...summarise(entries),
      today,
      unreadable,
    })
  }).pipe(
    Effect.provide(HistoryStore.layer),
    Effect.catch(error =>
      Effect.succeed(Message.FailedLoadHistory({ reason: error.reason })),
    ),
  ),
})

const shownTakeOf = (full: FullTake): ShownTake => ({
  id: full.entry.id,
  takenAt: full.entry.takenAt,
  day: full.entry.day,
  score: takeScoreOf(
    { score: scoreOfStored(full.entry.score), alignedTakeF0: full.alignedF0 },
    full.native,
  ),
  curve: takeCurveOf(full.take.curve),
  native: takeCurveOf(full.native.curve),
})

const shownTake = (
  history: HistoryStore['Service'],
  entry: TakeEntry,
): Effect.Effect<ShownTake, HistoryError> =>
  history.fullTake(entry.id).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () =>
          Effect.fail(
            new HistoryError({
              reason: `The take of ${entry.day} could not be read.`,
            }),
          ),
        onSome: full => Effect.succeed(shownTakeOf(full)),
      }),
    ),
  )

// What the device holds of a line now: a bundled line as it is, a line of
// the learner's clip by the curve it is copied from now, and its name now
// (its place in its clip may have moved), or that it is gone.
const lineAsKept = (
  history: HistoryStore['Service'],
  clipId: string,
  lineId: string,
): Effect.Effect<
  Readonly<{ asKept: LineAsKept; maybeName: Option.Option<string> }>,
  HistoryError
> =>
  Option.isSome(lineOf(clipId, lineId))
    ? Effect.succeed({ asKept: { _tag: 'Bundled' }, maybeName: Option.none() })
    : history.clipLine(clipId, lineId).pipe(
        Effect.map(
          Option.match({
            onNone: () => ({
              asKept: { _tag: 'Gone' } as const,
              maybeName: Option.none(),
            }),
            onSome: ({ clip, line }) => ({
              asKept: {
                _tag: 'Current' as const,
                maybeNativeId:
                  line.native._tag === 'Tracked'
                    ? Option.some(line.native.nativeId)
                    : Option.none(),
              },
              maybeName: Option.some(
                `${clip.name}, ${clipLineTitle(clip.lines.findIndex(found => found.id === lineId) + 1).toLowerCase()}`,
              ),
            }),
          }),
        ),
      )

// Reads a line's takes for its page: the trend of the line as it is now
// and of its takes before its span changed, and the first, best and
// latest whole, to draw.
export const LoadLineHistory = Command.define('LoadLineHistory', {
  args: { clipId: Schema.String, lineId: Schema.String },
  messages: [Message.SucceededLoadLineHistory, Message.FailedLoadLineHistory],
  execute: ({ clipId, lineId }) =>
    Effect.gen(function* () {
      const history = yield* HistoryStore
      const { entries } = yield* history.entries
      const { asKept, maybeName } = yield* lineAsKept(history, clipId, lineId)
      const maybeTakes = lineTakesOf(entries, clipId, lineId, asKept)
      if (Option.isNone(maybeTakes)) {
        return Message.SucceededLoadLineHistory({
          clipId,
          lineId,
          maybeFound: Option.none(),
        })
      }
      const { lineNow, takes, earlier, drawnFrom, first, maybeBest, latest } =
        maybeTakes.value
      const shown = yield* Effect.all({
        first: shownTake(history, first),
        maybeBest: Option.match(maybeBest, {
          onNone: () => Effect.succeedNone,
          onSome: best => Effect.asSome(shownTake(history, best)),
        }),
        latest: shownTake(history, latest),
      })
      return Message.SucceededLoadLineHistory({
        clipId,
        lineId,
        maybeFound: Option.some({
          lineText: Option.getOrElse(maybeName, () => latest.lineText),
          lineNow,
          trend: trendOf(takes),
          earlierTrend: trendOf(earlier),
          drawnFrom,
          ...shown,
        }),
      })
    }).pipe(
      Effect.provide(HistoryStore.layer),
      Effect.catch(error =>
        Effect.succeed(
          Message.FailedLoadLineHistory({
            clipId,
            lineId,
            reason: error.reason,
          }),
        ),
      ),
    ),
})

// How many takes one RescoreTakes scores, so the screen can say how far
// it has got and stays responsive between them.
export const rescoreBatch = 20

// Scores the takes `ids` again from their kept curves and features, with
// the score as it is now, and keeps the new scores; a take that no
// longer reads is left as it was.
export const RescoreTakes = Command.define('RescoreTakes', {
  args: { ids: Schema.Array(Schema.String) },
  messages: [Message.SucceededRescoreTakes, Message.FailedRescoreTakes],
  execute: ({ ids }) =>
    Effect.gen(function* () {
      const history = yield* HistoryStore
      const scorer = yield* Scorer
      const updates = yield* Effect.forEach(ids, id =>
        history.fullTake(id).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.succeedNone,
              onSome: full =>
                scorer
                  .score(full.native, full.take)
                  .pipe(
                    Effect.map(comparison => Option.some({ id, comparison })),
                  ),
            }),
          ),
        ),
      )
      const rescored = Array.getSomes(updates)
      yield* history.rescore(rescored)
      return Message.SucceededRescoreTakes({ rescored: rescored.length })
    }).pipe(
      Effect.provide([HistoryStore.layer, Scorer.layer]),
      Effect.catch(error =>
        Effect.succeed(Message.FailedRescoreTakes({ reason: error.reason })),
      ),
    ),
})

// Writes the find field's words to the address as they are typed,
// spaces and all, without a new history entry.
export const ReplaceFind = Command.define('ReplaceFind', {
  args: { words: Schema.String },
  messages: [Message.CompletedReplaceFind],
  execute: ({ words }) =>
    replaceUrl(
      historyRouter({
        maybeFind: words === '' ? Option.none() : Option.some(words),
      }),
    ).pipe(Effect.as(Message.CompletedReplaceFind())),
})

export const lineRowAttribute = 'line-row'

// Puts focus on the list's row `index`, the first of those just shown.
export const FocusLineRow = Command.define('FocusLineRow', {
  args: { index: Schema.Finite },
  messages: [Message.CompletedFocusLineRow],
  execute: ({ index }) =>
    Dom.focus(`[data-${lineRowAttribute}="${index}"]`).pipe(
      Effect.ignore,
      Effect.as(Message.CompletedFocusLineRow()),
    ),
})
