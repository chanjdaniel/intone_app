import { Match } from 'effect'
import type { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import type { MicrophoneFailure } from '../../services/microphone'
import type { Message } from '../message'
import type { Model } from '../model'
import { AnalyseTake, FocusTakeControl, WaitForMicAnswer } from './commands'
import type { TakeResourceServices } from './resources'
import { Take, type TakeResult, canStartTake, longestTakeSeconds } from './take'

// The take's transitions. Each is a fact about the take that update reads
// against the state the take is in; one that does not fit the state (a
// late timer, a result from an earlier take) leaves the Model as it is.

export type TakeUpdate = Update.Return<Model, Message, TakeResourceServices>

const unchanged = (model: Model): TakeUpdate => ({ model })

// Moves to `take` and puts focus on its next control.
const moveTo = (
  model: Model,
  take: Take,
  ...commands: Update.Commands<Message, TakeResourceServices>
): TakeUpdate => ({
  model: modifyFields(model, { take: () => take }),
  commands: [...commands, FocusTakeControl()],
})

export const clickedRecord = (model: Model): TakeUpdate => {
  if (!canStartTake(model.take)) {
    return unchanged(model)
  }
  const takeNumber = model.takesStarted + 1
  return {
    model: modifyFields(model, {
      take: () => Take.Preparing({ takeNumber }),
      takesStarted: () => takeNumber,
    }),
    commands: [FocusTakeControl()],
  }
}

export const clickedStop = (model: Model): TakeUpdate =>
  model.take._tag === 'Recording'
    ? moveTo(
        model,
        Take.Analysing({ takeNumber: model.take.takeNumber }),
        AnalyseTake({ takeNumber: model.take.takeNumber }),
      )
    : unchanged(model)

export const clickedCancelTake = (model: Model): TakeUpdate =>
  Match.value(model.take).pipe(
    Match.tag('Preparing', 'AwaitingMic', 'MicPromptIgnored', () =>
      moveTo(model, Take.Idle()),
    ),
    Match.orElse(() => unchanged(model)),
  )

export const acquiredTracker = (model: Model): TakeUpdate =>
  model.take._tag === 'Preparing'
    ? moveTo(
        model,
        Take.AwaitingMic({ takeNumber: model.take.takeNumber }),
        WaitForMicAnswer({ takeNumber: model.take.takeNumber }),
      )
    : unchanged(model)

export const failedAcquireTracker = (
  model: Model,
  reason: string,
): TakeUpdate =>
  model.take._tag === 'Preparing'
    ? moveTo(
        model,
        Take.AnalysisFailed({
          reason: `The pitch tracker did not start: ${reason}`,
        }),
      )
    : unchanged(model)

export const completedWaitForMicAnswer = (
  model: Model,
  takeNumber: number,
): TakeUpdate =>
  model.take._tag === 'AwaitingMic' && model.take.takeNumber === takeNumber
    ? moveTo(model, Take.MicPromptIgnored({ takeNumber }))
    : unchanged(model)

const isAsking = (take: Take): take is Take & { takeNumber: number } =>
  take._tag === 'AwaitingMic' || take._tag === 'MicPromptIgnored'

export const acquiredMicrophone = (model: Model): TakeUpdate =>
  isAsking(model.take)
    ? moveTo(
        model,
        Take.Recording({
          takeNumber: model.take.takeNumber,
          elapsedSeconds: 0,
        }),
      )
    : unchanged(model)

export const failedAcquireMicrophone = (
  model: Model,
  failure: MicrophoneFailure,
  reason: string,
): TakeUpdate =>
  isAsking(model.take)
    ? moveTo(
        model,
        Match.value(failure).pipe(
          Match.when('Denied', () => Take.MicDenied()),
          Match.when('NoDevice', () => Take.NoMicDevice()),
          Match.when('Failed', () => Take.MicFailed({ reason })),
          Match.exhaustive,
        ),
      )
    : unchanged(model)

export const tickedRecordingClock = (
  model: Model,
  takeNumber: number,
  elapsedSeconds: number,
): TakeUpdate => {
  if (model.take._tag !== 'Recording' || model.take.takeNumber !== takeNumber) {
    return unchanged(model)
  }
  if (elapsedSeconds >= longestTakeSeconds) {
    return moveTo(
      model,
      Take.Analysing({ takeNumber }),
      AnalyseTake({ takeNumber }),
    )
  }
  return {
    model: modifyFields(model, {
      take: () => Take.Recording({ takeNumber, elapsedSeconds }),
    }),
  }
}

const isTakeIn = (
  take: Take,
  tags: ReadonlyArray<Take['_tag']>,
  takeNumber: number,
): boolean =>
  tags.includes(take._tag) &&
  'takeNumber' in take &&
  take.takeNumber === takeNumber

export const failedRecordTake = (
  model: Model,
  takeNumber: number,
  reason: string,
): TakeUpdate =>
  isTakeIn(model.take, ['Recording'], takeNumber)
    ? moveTo(model, Take.AnalysisFailed({ reason }))
    : unchanged(model)

export const succeededAnalyseTake = (
  model: Model,
  takeNumber: number,
  result: TakeResult,
): TakeUpdate =>
  isTakeIn(model.take, ['Analysing'], takeNumber)
    ? moveTo(model, Take.ShowingResult({ takeNumber, result }))
    : unchanged(model)

export const failedAnalyseTake = (
  model: Model,
  takeNumber: number,
  reason: string,
): TakeUpdate =>
  isTakeIn(model.take, ['Analysing'], takeNumber)
    ? moveTo(model, Take.AnalysisFailed({ reason }))
    : unchanged(model)

// Leaving the screen abandons a take in progress, which releases its
// microphone and tracker.
export const leftScreen = (model: Model): Model =>
  canStartTake(model.take)
    ? model
    : modifyFields(model, { take: () => Take.Idle() })
