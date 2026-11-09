import { Effect, Option, Schema } from 'effect'
import { Command } from 'foldkit'

import { NativeCurves } from '../../services/native-curves'
import { Message } from '../message'
import { takeCurveOf, takeFeaturesOf } from '../take/take'
import { lineKey, lineOf } from './lines'

// Finds the line's native curve and features: from the device, or
// tracked from its audio by the take's own tracker and kept on the
// device.
export const LoadNativeCurve = Command.define('LoadNativeCurve', {
  args: { clipId: Schema.String, lineId: Schema.String },
  messages: [Message.SucceededLoadNativeCurve, Message.FailedLoadNativeCurve],
  execute: ({ clipId, lineId }) =>
    Effect.gen(function* () {
      const maybeLine = lineOf(clipId, lineId)
      if (Option.isNone(maybeLine)) {
        return Message.FailedLoadNativeCurve({
          clipId,
          lineId,
          reason: 'There is no such line.',
        })
      }
      const line = maybeLine.value
      const native = yield* NativeCurves
      const recording = yield* native.recordingOf({
        key: lineKey(line),
        audioUrl: line.audioUrl,
      })
      return Message.SucceededLoadNativeCurve({
        clipId,
        lineId,
        curve: takeCurveOf(recording.curve),
        features: takeFeaturesOf(recording.features),
      })
    }).pipe(
      Effect.provide(NativeCurves.layer),
      Effect.catch(error =>
        Effect.succeed(
          Message.FailedLoadNativeCurve({
            clipId,
            lineId,
            reason: error.reason,
          }),
        ),
      ),
    ),
})

export const isKnownLine = (clipId: string, lineId: string): boolean =>
  Option.isSome(lineOf(clipId, lineId))
