import { Duration, Effect, Schema } from 'effect'
import { Command, Dom } from 'foldkit'

import { Scorer } from '../../services/scorer'
import { recordingOfTracked } from '../../services/tracker'
import { Message } from '../message'
import { TrackerResource } from './resources'
import {
  NativeRecording,
  TakeResult,
  micPromptPatienceSeconds,
  recordingOfNative,
  takeCurveOf,
  takeScoreOf,
} from './take'
import { forgetTakeAudio } from './takeAudio'

// The element each take state puts focus on when it appears, marked by
// this data attribute: its one button, or its heading when it has none.
export const takeFocusAttribute = 'take-focus'

export const WaitForMicAnswer = Command.define('WaitForMicAnswer', {
  args: { takeNumber: Schema.Finite },
  messages: [Message.CompletedWaitForMicAnswer],
  execute: ({ takeNumber }) =>
    Effect.sleep(Duration.seconds(micPromptPatienceSeconds)).pipe(
      Effect.as(Message.CompletedWaitForMicAnswer({ takeNumber })),
    ),
})

// Asks the tracker for the finished take's curve and features, and the
// Scorer for its score against `native`: the one Message that brings the
// take's curve into the Model, with its score. The take's features go
// from the tracker to the score and no further.
export const AnalyseTake = Command.define('AnalyseTake', {
  args: { takeNumber: Schema.Finite, native: NativeRecording },
  messages: [Message.SucceededAnalyseTake, Message.FailedAnalyseTake],
  execute: ({ takeNumber, native }) =>
    Effect.gen(function* () {
      const tracker = yield* TrackerResource.get
      const result = yield* tracker.finish
      if (result._tag !== 'Tracked') {
        return Message.SucceededAnalyseTake({
          takeNumber,
          result:
            result._tag === 'TooQuiet'
              ? TakeResult.TooQuiet()
              : TakeResult.TooNoisy(),
        })
      }
      const scorer = yield* Scorer
      const nativeRecording = recordingOfNative(native)
      const take = recordingOfTracked(result)
      const comparison = yield* scorer.score(nativeRecording, take)
      return Message.SucceededAnalyseTake({
        takeNumber,
        result: TakeResult.Tracked({
          curve: takeCurveOf(take.curve),
          score: takeScoreOf(comparison, nativeRecording),
        }),
      })
    }).pipe(
      Effect.provide(Scorer.layer),
      Effect.catchTag('ResourceNotAvailable', () =>
        Effect.succeed(
          Message.FailedAnalyseTake({
            takeNumber,
            reason: 'The pitch tracker had already stopped.',
          }),
        ),
      ),
      Effect.catch(error =>
        Effect.succeed(
          Message.FailedAnalyseTake({ takeNumber, reason: error.reason }),
        ),
      ),
    ),
})

export const FocusTakeControl = Command.define('FocusTakeControl', {
  messages: [Message.CompletedFocusTakeControl],
  execute: Dom.focus(`[data-${takeFocusAttribute}]`).pipe(
    Effect.ignore,
    Effect.as(Message.CompletedFocusTakeControl()),
  ),
})

// Lets the last take's audio go, when its line is left.
export const ForgetTakeAudio = Command.define('ForgetTakeAudio', {
  messages: [Message.CompletedForgetTakeAudio],
  execute: forgetTakeAudio.pipe(Effect.as(Message.CompletedForgetTakeAudio())),
})
