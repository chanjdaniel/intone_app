import { Clock, Duration, Effect, Schema } from 'effect'
import { Calendar, Command, Dom } from 'foldkit'

import type { Recording } from '../../score/score'
import { TakeMode } from '../../services/history-records'
import { HistoryStore } from '../../services/history-store'
import { type Comparison, Scorer } from '../../services/scorer'
import { recordingOfTracked } from '../../services/tracker'
import { isoDayOf } from '../history/format'
import { Message } from '../message'
import { TrackerResource } from './resources'
import {
  KeptInHistory,
  NativeRecording,
  TakeResult,
  micPromptPatienceSeconds,
  recordingOfNative,
  takeCurveOf,
  takeScoreOf,
} from './take'
import { forgetTakeAudio, takeAudioOf } from './takeAudio'

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

// The line a take copies, as the history names it.
export const TakeLine = Schema.Struct({
  clipId: Schema.String,
  lineId: Schema.String,
  lineText: Schema.String,
})
export type TakeLine = typeof TakeLine.Type

// Keeps a scored take in the history on the device, with its audio when
// the learner keeps audio; a take the history cannot keep is still
// shown, and says so.
const keepTake = (
  takeNumber: number,
  mode: TakeMode,
  line: TakeLine,
  native: Recording,
  take: Recording,
  comparison: Comparison,
): Effect.Effect<KeptInHistory> =>
  Effect.gen(function* () {
    const history = yield* HistoryStore
    const takenAt = yield* Clock.currentTimeMillis
    const audio = yield* takeAudioOf(takeNumber)
    const kept = yield* history.keep({
      ...line,
      mode,
      takenAt,
      day: isoDayOf(Calendar.fromDateLocal(new Date(takenAt))),
      native,
      take,
      comparison,
      audio,
    })
    return KeptInHistory.Kept({
      id: kept.entry.id,
      maybeAudioFailure: kept.maybeAudioFailure,
    })
  }).pipe(
    Effect.provide(HistoryStore.layer),
    Effect.catch(error =>
      Effect.succeed(KeptInHistory.NotKept({ reason: error.reason })),
    ),
  )

// Asks the tracker for the finished take's curve and features, the
// Scorer for its score against `native`, and the history to keep it: the
// one Message that brings the take's curve into the Model, with its
// score. The take's features go from the tracker to the score and the
// history, never into the Model. The history keeps it as guided or
// blind, which is what its stars are read by.
export const AnalyseTake = Command.define('AnalyseTake', {
  args: {
    takeNumber: Schema.Finite,
    mode: TakeMode,
    line: TakeLine,
    native: NativeRecording,
  },
  messages: [Message.SucceededAnalyseTake, Message.FailedAnalyseTake],
  execute: ({ takeNumber, mode, line, native }) =>
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
      const kept = yield* keepTake(
        takeNumber,
        mode,
        line,
        nativeRecording,
        take,
        comparison,
      )
      return Message.SucceededAnalyseTake({
        takeNumber,
        result: TakeResult.Tracked({
          curve: takeCurveOf(take.curve),
          score: takeScoreOf(comparison, nativeRecording),
          kept,
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
