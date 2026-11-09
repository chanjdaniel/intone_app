import { Effect, Option, Schema } from 'effect'
import { Command, Dom } from 'foldkit'
import { pushUrl } from 'foldkit/navigation'

import { Message } from '../message'
import { levelRouter } from '../route'

// The upload screen's Commands: opening the clip's lines once they are
// kept, and putting focus on the status of the cut as it starts and
// ends, so a screen reader hears where it is.

export const uploadStatusAttribute = 'upload-status'

export const OpenLevel = Command.define('OpenLevel', {
  args: { clipId: Schema.String },
  messages: [Message.CompletedOpenLevel],
  execute: ({ clipId }) =>
    pushUrl(levelRouter({ clipId, maybeFind: Option.none() })).pipe(
      Effect.as(Message.CompletedOpenLevel()),
    ),
})

export const FocusUploadStatus = Command.define('FocusUploadStatus', {
  messages: [Message.CompletedFocusUploadStatus],
  execute: Dom.focus(`[data-${uploadStatusAttribute}]`).pipe(
    Effect.ignore,
    Effect.as(Message.CompletedFocusUploadStatus()),
  ),
})
