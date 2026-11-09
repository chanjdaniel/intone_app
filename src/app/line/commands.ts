import { Effect, Option, Schema } from 'effect'
import { Command } from 'foldkit'

import { HistoryStore } from '../../services/history-store'
import { NativeCurves } from '../../services/native-curves'
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
    if (clip.audio === null) {
      return Message.FailedLoadNativeCurve({
        clipId,
        lineId,
        failure: 'Failed',
        reason:
          'This clip’s audio is not on this device: the backup it came from left it out. Bring the file again to practise it.',
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
      line: practiceLineOfClip(clip, line, clip.audio),
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
