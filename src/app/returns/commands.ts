import { Effect, Option, Schema } from 'effect'
import { Calendar, Command, Dom } from 'foldkit'
import { replaceUrl } from 'foldkit/navigation'

import { HistoryStore } from '../../services/history-store'
import { isoDayOf } from '../history/format'
import { levelSourcesOf } from '../level/commands'
import { Message } from '../message'
import { homeRouter } from '../route'
import { dueLinesOf } from './returns'

// Reads the lines due back on the learner's day, from every level's
// lines and the takes kept on the device.
export const LoadDueLines = Command.define('LoadDueLines', {
  messages: [Message.SucceededLoadDueLines, Message.FailedLoadDueLines],
  execute: Effect.gen(function* () {
    const history = yield* HistoryStore
    const sources = yield* levelSourcesOf(history)
    const { entries } = yield* history.entries
    const today = isoDayOf(yield* Calendar.today.local)
    const { due, maybeNextOn } = dueLinesOf(entries, sources, today)
    return Message.SucceededLoadDueLines({ today, lines: due, maybeNextOn })
  }).pipe(
    Effect.provide(HistoryStore.layer),
    Effect.catch(error =>
      Effect.succeed(Message.FailedLoadDueLines({ reason: error.reason })),
    ),
  ),
})

// Writes the find words to the address as they are typed.
export const ReplaceDueFind = Command.define('ReplaceDueFind', {
  args: { words: Schema.String },
  messages: [Message.CompletedReplaceDueFind],
  execute: ({ words }) =>
    replaceUrl(
      homeRouter({
        maybeFind: words === '' ? Option.none() : Option.some(words),
      }),
    ).pipe(Effect.as(Message.CompletedReplaceDueFind())),
})

export const dueRowAttribute = 'due-row'

// Puts focus on the list's row `index`, the first of those just shown.
export const FocusDueRow = Command.define('FocusDueRow', {
  args: { index: Schema.Finite },
  messages: [Message.CompletedFocusDueRow],
  execute: ({ index }) =>
    Dom.focus(`[data-${dueRowAttribute}="${index}"]`).pipe(
      Effect.ignore,
      Effect.as(Message.CompletedFocusDueRow()),
    ),
})
