import { Effect, Option, Schema } from 'effect'
import { Command } from 'foldkit'

import {
  type LineReadings,
  ReadingFix,
  type Settings,
} from '../../services/history-records'
import { HistoryStore } from '../../services/history-store'
import { bundledClipOf, lineKey } from '../line/lines'
import { Message } from '../message'
import { ReadingsShown, shownWordsOf } from './readings'
import { ReadingsResource } from './resources'

// What a line's readings read and write on the device: whether the
// learner shows them, kept with the settings, and their corrections, kept
// with the line (a clip's line on its record, a bundled line in the
// settings, having none). Nothing here sends anything anywhere.

export const LoadReadingsChoice = Command.define('LoadReadingsChoice', {
  messages: [
    Message.SucceededLoadReadingsChoice,
    Message.FailedLoadReadingsChoice,
  ],
  execute: HistoryStore.use(history => history.settings).pipe(
    Effect.map(settings =>
      Message.SucceededLoadReadingsChoice({
        maybeShown: Option.fromNullishOr(settings.readings),
      }),
    ),
    Effect.provide(HistoryStore.layer),
    Effect.catch(error =>
      Effect.succeed(
        Message.FailedLoadReadingsChoice({ reason: error.reason }),
      ),
    ),
  ),
})

const changeSettings = (change: (settings: Settings) => Settings) =>
  HistoryStore.use(history => history.updateSettings(change))

export const SetReadingsChoice = Command.define('SetReadingsChoice', {
  args: { shown: ReadingsShown },
  messages: [
    Message.SucceededSetReadingsChoice,
    Message.FailedSetReadingsChoice,
  ],
  execute: ({ shown }) =>
    changeSettings(settings => ({ ...settings, readings: shown })).pipe(
      Effect.as(Message.SucceededSetReadingsChoice()),
      Effect.provide(HistoryStore.layer),
      Effect.catch(error =>
        Effect.succeed(
          Message.FailedSetReadingsChoice({ reason: error.reason }),
        ),
      ),
    ),
})

const isBundled = (clipId: string): boolean =>
  Option.isSome(bundledClipOf(clipId))

// The learner's corrections to a line's readings, as the device keeps
// them.
const keptReadings = (clipId: string, lineId: string) =>
  Effect.gen(function* () {
    const history = yield* HistoryStore
    if (isBundled(clipId)) {
      const settings = yield* history.settings
      return Option.fromNullishOr(
        settings.bundledReadings?.[lineKey({ clipId, lineId })],
      )
    }
    const maybeClip = yield* history.clip(clipId)
    return Option.flatMapNullishOr(
      maybeClip,
      clip => clip.lines.find(line => line.id === lineId)?.readings,
    )
  })

// The open line's words with their readings, from the readings Worker,
// with the learner's corrections when they were made on this text.
export const ReadLineReadings = Command.define('ReadLineReadings', {
  args: { clipId: Schema.String, lineId: Schema.String, text: Schema.String },
  messages: [Message.SucceededReadLineReadings, Message.FailedReadLineReadings],
  execute: ({ clipId, lineId, text }) =>
    Effect.gen(function* () {
      const session = yield* ReadingsResource.get
      const [words = []] = yield* session.read([text])
      const kept = yield* keptReadings(clipId, lineId).pipe(
        Effect.provide(HistoryStore.layer),
        Effect.orElseSucceed(() => Option.none<LineReadings>()),
      )
      return Message.SucceededReadLineReadings({
        clipId,
        lineId,
        text,
        words: shownWordsOf(text, words, kept),
      })
    }).pipe(
      Effect.catch(error =>
        Effect.succeed(
          Message.FailedReadLineReadings({
            clipId,
            lineId,
            text,
            reason:
              error._tag === 'ReadingsError'
                ? error.reason
                : 'The readings are not loaded.',
          }),
        ),
      ),
    ),
})

// Keeps the learner's corrections to a line's readings, made on `text`;
// none forgets them.
export const SetLineReadings = Command.define('SetLineReadings', {
  args: {
    clipId: Schema.String,
    lineId: Schema.String,
    text: Schema.String,
    fixes: Schema.Array(ReadingFix),
  },
  messages: [Message.SucceededSetLineReadings, Message.FailedSetLineReadings],
  execute: ({ clipId, lineId, text, fixes }) => {
    const readings = fixes.length === 0 ? undefined : { text, fixes }
    const kept = isBundled(clipId)
      ? changeSettings(settings => {
          const { [lineKey({ clipId, lineId })]: _was, ...others } =
            settings.bundledReadings ?? {}
          return {
            ...settings,
            bundledReadings:
              readings === undefined
                ? others
                : { ...others, [lineKey({ clipId, lineId })]: readings },
          }
        }).pipe(Effect.as(true))
      : HistoryStore.use(history =>
          history.setLineReadings(clipId, lineId, readings),
        ).pipe(Effect.map(Option.isSome))
    return kept.pipe(
      Effect.map(found =>
        found
          ? Message.SucceededSetLineReadings({ clipId, lineId })
          : Message.FailedSetLineReadings({
              clipId,
              lineId,
              reason:
                'The readings were not kept. The line is no longer on this device.',
            }),
      ),
      Effect.provide(HistoryStore.layer),
      Effect.catch(error =>
        Effect.succeed(
          Message.FailedSetLineReadings({
            clipId,
            lineId,
            reason: error.reason,
          }),
        ),
      ),
    )
  },
})
