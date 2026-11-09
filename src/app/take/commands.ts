import { Duration, Effect, Schema } from 'effect'
import { Command, Dom } from 'foldkit'

import { Message } from '../message'
import { TrackerResource } from './resources'
import { micPromptPatienceSeconds, takeResultOf } from './take'
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

// Asks the tracker for the finished take's curve: the one Message that
// brings it into the Model.
export const AnalyseTake = Command.define('AnalyseTake', {
  args: { takeNumber: Schema.Finite },
  messages: [Message.SucceededAnalyseTake, Message.FailedAnalyseTake],
  execute: ({ takeNumber }) =>
    Effect.gen(function* () {
      const tracker = yield* TrackerResource.get
      const result = yield* tracker.finish
      return Message.SucceededAnalyseTake({
        takeNumber,
        result: takeResultOf(result),
      })
    }).pipe(
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
