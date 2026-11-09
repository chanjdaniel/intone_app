import { Effect, Option, Schema } from 'effect'
import { Calendar, Command } from 'foldkit'

import { lineAudioOf } from '../../services/history-records'
import { HistoryStore } from '../../services/history-store'
import { NativeCurves } from '../../services/native-curves'
import { isoDayOf } from '../history/format'
import { lineProgressOf, lineReturnOf } from '../history/history'
import { levelSourceOf, nextLineOf } from '../level/commands'
import { Message } from '../message'
import { takeCurveOf, takeFeaturesOf } from '../take/take'
import {
  lineKey,
  lineOf,
  practiceLineOfBundled,
  practiceLineOfClip,
} from './lines'

// Finds the line and its native curve and features. A bundled line's
// curve comes from the device, or is tracked from its audio by the take's
// own tracker and kept on the device; a line of the learner's clip was
// tracked when the clip was cut, and is read from the history.

const bundledNative = (clipId: string, lineId: string) =>
  Effect.gen(function* () {
    const maybeLine = lineOf(clipId, lineId)
    if (Option.isNone(maybeLine)) {
      return Option.none()
    }
    const line = maybeLine.value
    const native = yield* NativeCurves
    const recording = yield* native.recordingOf({
      key: lineKey(line),
      audioUrl: line.audioUrl,
    })
    return Option.some(
      Message.SucceededLoadNativeCurve({
        clipId,
        lineId,
        line: practiceLineOfBundled(line),
        curve: takeCurveOf(recording.curve),
        features: takeFeaturesOf(recording.features),
      }),
    )
  }).pipe(Effect.provide(NativeCurves.layer))

const clipNative = (clipId: string, lineId: string) =>
  Effect.gen(function* () {
    const history = yield* HistoryStore
    const maybeFound = yield* history.clipLine(clipId, lineId)
    if (Option.isNone(maybeFound)) {
      return Message.FailedLoadNativeCurve({
        clipId,
        lineId,
        failure: 'NoSuchLine',
        reason: 'There is no such line on this device.',
      })
    }
    const { clip, line, maybeNative } = maybeFound.value
    const audio = lineAudioOf(clip, line)
    if (audio === null) {
      return Message.FailedLoadNativeCurve({
        clipId,
        lineId,
        failure: 'Failed',
        reason:
          clip.pack === undefined
            ? 'This clip’s audio is not on this device: the backup it came from left it out. Bring the file again to practise it.'
            : 'This line’s audio is not on this device: the backup it came from left it out. Import the pack again to practise it.',
      })
    }
    if (Option.isNone(maybeNative)) {
      return Message.FailedLoadNativeCurve({
        clipId,
        lineId,
        failure: 'Failed',
        reason:
          line.native._tag === 'Tracked'
            ? 'Its curve could not be read from this device.'
            : `It was too ${line.native._tag === 'TooQuiet' ? 'quiet' : 'noisy'} to find its pitch, so it cannot be copied.`,
      })
    }
    return Message.SucceededLoadNativeCurve({
      clipId,
      lineId,
      line: practiceLineOfClip(clip, line, audio),
      curve: takeCurveOf(maybeNative.value.curve),
      features: takeFeaturesOf(maybeNative.value.features),
    })
  }).pipe(Effect.provide(HistoryStore.layer))

export const LoadNativeCurve = Command.define('LoadNativeCurve', {
  args: { clipId: Schema.String, lineId: Schema.String },
  messages: [Message.SucceededLoadNativeCurve, Message.FailedLoadNativeCurve],
  execute: ({ clipId, lineId }) =>
    bundledNative(clipId, lineId).pipe(
      Effect.flatMap(
        Option.match({
          onSome: Effect.succeed,
          onNone: () => clipNative(clipId, lineId),
        }),
      ),
      Effect.catch(error =>
        Effect.succeed(
          Message.FailedLoadNativeCurve({
            clipId,
            lineId,
            failure: 'Failed',
            reason: error.reason,
          }),
        ),
      ),
    ),
})

// Reads the line's place in its level: the level's name, the line's
// stars and best from its takes kept on the device, and the next line
// that can be copied.
export const LoadLinePlace = Command.define('LoadLinePlace', {
  args: { clipId: Schema.String, lineId: Schema.String },
  messages: [Message.SucceededLoadLinePlace, Message.FailedLoadLinePlace],
  execute: ({ clipId, lineId }) =>
    Effect.gen(function* () {
      const history = yield* HistoryStore
      const maybeSource = yield* levelSourceOf(history, clipId)
      const maybeLine = Option.flatMap(maybeSource, source =>
        Option.fromNullishOr(source.lines.find(line => line.lineId === lineId)),
      )
      if (Option.isNone(maybeSource) || Option.isNone(maybeLine)) {
        return Message.FailedLoadLinePlace({
          clipId,
          lineId,
          reason: 'There is no such line on this device.',
        })
      }
      const { entries } = yield* history.entries
      const { asKept } = maybeLine.value
      return Message.SucceededLoadLinePlace({
        clipId,
        lineId,
        levelName: maybeSource.value.name,
        progress: lineProgressOf(entries, clipId, lineId, asKept),
        maybeNext: nextLineOf(maybeSource.value, lineId),
        today: isoDayOf(yield* Calendar.today.local),
        maybeReturn: lineReturnOf(entries, clipId, lineId, asKept),
      })
    }).pipe(
      Effect.provide(HistoryStore.layer),
      Effect.catch(error =>
        Effect.succeed(
          Message.FailedLoadLinePlace({ clipId, lineId, reason: error.reason }),
        ),
      ),
    ),
})
