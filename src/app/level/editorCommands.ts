import { Duration, Effect, Option, Schema } from 'effect'
import { Command, Dom } from 'foldkit'

import { LineEdit } from '../../services/clip-edits'
import { HistoryStore } from '../../services/history-store'
import { Message } from '../message'
import { keysRestMillis } from './editor'
import { levelClipOf } from './level'
import { ClipEditorResource } from './resources'

// The line editor's Commands: a change kept on the device, the lines it
// moves tracked again first by the clip Worker the level holds; the one
// undo; and the rest the keys take before an edge they moved is kept.

const noSuchClip = 'The clip is no longer on this device.'

// Changes the lines of clip `clipId` by `edit`, and gives the clip as it
// then is.
export const EditClipLines = Command.define('EditClipLines', {
  args: { clipId: Schema.String, edit: LineEdit },
  messages: [Message.SucceededEditClipLines, Message.FailedEditClipLines],
  execute: ({ clipId, edit }) =>
    Effect.gen(function* () {
      const editor = yield* ClipEditorResource.get
      const history = yield* HistoryStore
      const maybeClip = yield* history.editClipLines(clipId, edit, editor.track)
      return Option.match(maybeClip, {
        onNone: () =>
          Message.FailedEditClipLines({ clipId, reason: noSuchClip }),
        onSome: clip =>
          Message.SucceededEditClipLines({ clipId, clip: levelClipOf(clip) }),
      })
    }).pipe(
      Effect.provide(HistoryStore.layer),
      Effect.catch(error =>
        Effect.succeed(
          Message.FailedEditClipLines({
            clipId,
            reason:
              'reason' in error
                ? error.reason
                : 'The clip is not ready to change yet.',
          }),
        ),
      ),
    ),
})

// Undoes the last change to clip `clipId`'s lines.
export const UndoClipLineChange = Command.define('UndoClipLineChange', {
  args: { clipId: Schema.String },
  messages: [Message.SucceededEditClipLines, Message.FailedEditClipLines],
  execute: ({ clipId }) =>
    Effect.gen(function* () {
      const history = yield* HistoryStore
      const maybeClip = yield* history.undoClipEdit(clipId)
      return Option.match(maybeClip, {
        onNone: () =>
          Message.FailedEditClipLines({ clipId, reason: noSuchClip }),
        onSome: clip =>
          Message.SucceededEditClipLines({ clipId, clip: levelClipOf(clip) }),
      })
    }).pipe(
      Effect.provide(HistoryStore.layer),
      Effect.catch(error =>
        Effect.succeed(
          Message.FailedEditClipLines({ clipId, reason: error.reason }),
        ),
      ),
    ),
})

// Waits for the keys to rest, after they moved edge draft `draftNumber`.
export const WaitForKeysToRest = Command.define('WaitForKeysToRest', {
  args: { draftNumber: Schema.Finite },
  messages: [Message.CompletedWaitForKeysToRest],
  execute: ({ draftNumber }) =>
    Effect.sleep(Duration.millis(keysRestMillis)).pipe(
      Effect.as(Message.CompletedWaitForKeysToRest({ draftNumber })),
    ),
})

export const lineEditorId = 'line-editor'

// Puts focus on the line editor, once a line is chosen from the list.
export const FocusLineEditor = Command.define('FocusLineEditor', {
  messages: [Message.CompletedFocusLineEditor],
  execute: Dom.focus(`#${lineEditorId}`).pipe(
    Effect.ignore,
    Effect.as(Message.CompletedFocusLineEditor()),
  ),
})
