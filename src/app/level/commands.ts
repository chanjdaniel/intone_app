import { Effect, Option, Schema } from 'effect'
import { Command, Dom } from 'foldkit'
import { pushUrl, replaceUrl } from 'foldkit/navigation'

import { HistoryStore } from '../../services/history-store'
import { Message } from '../message'
import { homeRouter, levelRouter } from '../route'
import { clipSummaryOf, levelClipOf } from './level'

// Reading the learner's clips from the device, for the home screen.
export const LoadClips = Command.define('LoadClips', {
  messages: [Message.SucceededLoadClips, Message.FailedLoadClips],
  execute: Effect.gen(function* () {
    const history = yield* HistoryStore
    const { clips } = yield* history.clips
    return Message.SucceededLoadClips({ clips: clips.map(clipSummaryOf) })
  }).pipe(
    Effect.provide(HistoryStore.layer),
    Effect.catch(error =>
      Effect.succeed(Message.FailedLoadClips({ reason: error.reason })),
    ),
  ),
})

// Reading one clip and its lines, for its level.
export const LoadLevel = Command.define('LoadLevel', {
  args: { clipId: Schema.String },
  messages: [Message.SucceededLoadLevel, Message.FailedLoadLevel],
  execute: ({ clipId }) =>
    Effect.gen(function* () {
      const history = yield* HistoryStore
      const maybeClip = yield* history.clip(clipId)
      return Message.SucceededLoadLevel({
        clipId,
        maybeClip: Option.map(maybeClip, levelClipOf),
      })
    }).pipe(
      Effect.provide(HistoryStore.layer),
      Effect.catch(error =>
        Effect.succeed(
          Message.FailedLoadLevel({ clipId, reason: error.reason }),
        ),
      ),
    ),
})

// Writes the find words to the address as they are typed.
export const ReplaceLevelFind = Command.define('ReplaceLevelFind', {
  args: { clipId: Schema.String, words: Schema.String },
  messages: [Message.CompletedReplaceLevelFind],
  execute: ({ clipId, words }) =>
    replaceUrl(
      levelRouter({
        clipId,
        maybeFind: words === '' ? Option.none() : Option.some(words),
      }),
    ).pipe(Effect.as(Message.CompletedReplaceLevelFind())),
})

export const levelRowAttribute = 'level-row'

// Puts focus on the list's row `index`, the first of those just shown.
export const FocusLevelRow = Command.define('FocusLevelRow', {
  args: { index: Schema.Finite },
  messages: [Message.CompletedFocusLevelRow],
  execute: ({ index }) =>
    Dom.focus(`[data-${levelRowAttribute}="${index}"]`).pipe(
      Effect.ignore,
      Effect.as(Message.CompletedFocusLevelRow()),
    ),
})

// Deletes the clip with all its lines, their curves, its takes and its
// files.
export const DeleteClip = Command.define('DeleteClip', {
  args: { clipId: Schema.String, name: Schema.String },
  messages: [Message.SucceededDeleteClip, Message.FailedDeleteClip],
  execute: ({ clipId, name }) =>
    Effect.gen(function* () {
      const history = yield* HistoryStore
      yield* history.removeClip(clipId)
      return Message.SucceededDeleteClip({ clipId, name })
    }).pipe(
      Effect.provide(HistoryStore.layer),
      Effect.catch(error =>
        Effect.succeed(
          Message.FailedDeleteClip({ clipId, reason: error.reason }),
        ),
      ),
    ),
})

export const GoHome = Command.define('GoHome', {
  messages: [Message.CompletedGoHome],
  execute: pushUrl(homeRouter()).pipe(Effect.as(Message.CompletedGoHome())),
})
