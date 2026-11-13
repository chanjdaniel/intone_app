import { Effect, Option, Schema } from 'effect'
import { Command, Dom } from 'foldkit'

import { TextChoice } from '../../services/history-records'
import { HistoryStore } from '../../services/history-store'
import { levelClipOf } from '../level/level'
import { Message } from '../message'

// What the text of the learner's clips reads and writes on the device:
// their answer to the text model's download, kept with the settings, and
// the text they give a line. Nothing here sends anything anywhere.

export const LoadTextChoice = Command.define('LoadTextChoice', {
  messages: [Message.SucceededLoadTextChoice, Message.FailedLoadTextChoice],
  execute: HistoryStore.use(history => history.settings).pipe(
    Effect.map(settings =>
      Message.SucceededLoadTextChoice({
        maybeChoice: Option.fromNullishOr(settings.textChoice),
      }),
    ),
    Effect.provide(HistoryStore.layer),
    Effect.catch(error =>
      Effect.succeed(Message.FailedLoadTextChoice({ reason: error.reason })),
    ),
  ),
})

// Keeps the learner's answer with the rest of the settings.
export const SetTextChoice = Command.define('SetTextChoice', {
  args: { choice: TextChoice },
  messages: [Message.SucceededSetTextChoice, Message.FailedSetTextChoice],
  execute: ({ choice }) =>
    HistoryStore.use(history =>
      history.settings.pipe(
        Effect.flatMap(settings =>
          history.setSettings({ ...settings, textChoice: choice }),
        ),
      ),
    ).pipe(
      Effect.as(Message.SucceededSetTextChoice()),
      Effect.provide(HistoryStore.layer),
      Effect.catch(error =>
        Effect.succeed(Message.FailedSetTextChoice({ reason: error.reason })),
      ),
    ),
})

// Gives each line named the text the learner typed or pasted.
export const SetLineTexts = Command.define('SetLineTexts', {
  args: {
    clipId: Schema.String,
    texts: Schema.Array(
      Schema.Struct({ lineId: Schema.String, text: Schema.String }),
    ),
  },
  messages: [Message.SucceededSetLineTexts, Message.FailedSetLineTexts],
  execute: ({ clipId, texts }) =>
    HistoryStore.use(history => history.setLineTexts(clipId, texts)).pipe(
      Effect.map(maybeClip =>
        Option.match(maybeClip, {
          onNone: () =>
            Message.FailedSetLineTexts({
              clipId,
              reason:
                'The text was not kept. The clip is no longer on this device.',
            }),
          onSome: clip =>
            Message.SucceededSetLineTexts({ clipId, clip: levelClipOf(clip) }),
        }),
      ),
      Effect.provide(HistoryStore.layer),
      Effect.catch(error =>
        Effect.succeed(
          Message.FailedSetLineTexts({ clipId, reason: error.reason }),
        ),
      ),
    ),
})

export const FocusLineText = Command.define('FocusLineText', {
  args: { id: Schema.String },
  messages: [Message.CompletedFocusLineText],
  execute: ({ id }) =>
    Dom.focus(`#${id}`).pipe(
      Effect.ignore,
      Effect.as(Message.CompletedFocusLineText()),
    ),
})
