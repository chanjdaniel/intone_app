import { Match, Option } from 'effect'
import type { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import type { MicrophoneFailure } from '../../services/microphone'
import type { Message } from '../message'
import type { Model } from '../model'
import { AskToPersistStorage } from '../settings/commands'
import { AnalyseTake, FocusTakeControl, WaitForMicAnswer } from './commands'
import type { TakeResourceServices } from './resources'
import {
  type Extent,
  type FinishedTake,
  Take,
  type TakeResult,
  type Voice,
  canStartTake,
  levelMeterFloorDb,
  longestTakeSeconds,
  worstStretchOf,
} from './take'

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

// A take starts by playing the line, once its native curve is ready to
// compare with; the tracker loads while it plays.
export const clickedRecord = (model: Model): TakeUpdate => {
  if (!canStartTake(model.take) || model.native._tag !== 'Ready') {
    return unchanged(model)
  }
  const takeNumber = model.takesStarted + 1
  return {
    model: modifyFields(model, {
      take: () => Take.PlayingNative({ takeNumber, tracker: 'Loading' }),
      takesStarted: () => takeNumber,
      maybePlaybackFailure: () => Option.none(),
    }),
    commands: [FocusTakeControl()],
  }
}

const askForMicrophone = (model: Model, takeNumber: number): TakeUpdate =>
  moveTo(
    model,
    Take.AwaitingMic({ takeNumber }),
    WaitForMicAnswer({ takeNumber }),
  )

// The line has played: the microphone opens, once the tracker is ready.
export const endedNativeBeforeTake = (
  model: Model,
  takeNumber: number,
): TakeUpdate => {
  const take = model.take
  if (take._tag !== 'PlayingNative' || take.takeNumber !== takeNumber) {
    return unchanged(model)
  }
  return take.tracker === 'Ready'
    ? askForMicrophone(model, takeNumber)
    : moveTo(model, Take.Preparing({ takeNumber }))
}

// The take has ended: it is tracked, then scored against the line's
// native curve, which a take never starts without, and kept in the
// history under its line.
const analyse = (model: Model, takeNumber: number): TakeUpdate => {
  const native = model.native
  if (native._tag !== 'Ready') {
    return moveTo(
      model,
      Take.AnalysisFailed({ reason: "The line's curve is not loaded." }),
    )
  }
  return moveTo(
    model,
    Take.Analysing({ takeNumber }),
    AnalyseTake({
      takeNumber,
      line: {
        clipId: native.clipId,
        lineId: native.lineId,
        lineText: native.line.historyText,
      },
      native: { curve: native.curve, features: native.features },
    }),
  )
}

export const clickedStop = (model: Model): TakeUpdate =>
  model.take._tag === 'Recording'
    ? analyse(model, model.take.takeNumber)
    : unchanged(model)

export const clickedCancelTake = (model: Model): TakeUpdate =>
  Match.value(model.take).pipe(
    Match.tag(
      'PlayingNative',
      'Preparing',
      'AwaitingMic',
      'MicPromptIgnored',
      () => moveTo(model, Take.Idle()),
    ),
    Match.orElse(() => unchanged(model)),
  )

export const acquiredTracker = (model: Model): TakeUpdate =>
  Match.value(model.take).pipe(
    Match.tag('Preparing', ({ takeNumber }) =>
      askForMicrophone(model, takeNumber),
    ),
    Match.tag('PlayingNative', ({ takeNumber }) => ({
      model: modifyFields(model, {
        take: () => Take.PlayingNative({ takeNumber, tracker: 'Ready' }),
      }),
    })),
    Match.orElse(() => unchanged(model)),
  )

export const failedAcquireTracker = (
  model: Model,
  reason: string,
): TakeUpdate =>
  model.take._tag === 'Preparing' || model.take._tag === 'PlayingNative'
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
          levelDb: levelMeterFloorDb,
          maybeOnsetSeconds: Option.none(),
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

export const tickedTakeMeter = (
  model: Model,
  takeNumber: number,
  elapsedSeconds: number,
  levelDb: number,
): TakeUpdate => {
  const take = model.take
  if (take._tag !== 'Recording' || take.takeNumber !== takeNumber) {
    return unchanged(model)
  }
  if (elapsedSeconds >= longestTakeSeconds) {
    return analyse(model, takeNumber)
  }
  return {
    model: modifyFields(model, {
      take: () =>
        Take.Recording({
          takeNumber,
          elapsedSeconds,
          levelDb,
          maybeOnsetSeconds: take.maybeOnsetSeconds,
        }),
    }),
  }
}

export const detectedVoiceOnset = (
  model: Model,
  takeNumber: number,
  onsetSeconds: number,
): TakeUpdate => {
  const take = model.take
  if (take._tag !== 'Recording' || take.takeNumber !== takeNumber) {
    return unchanged(model)
  }
  return {
    model: modifyFields(model, {
      take: () =>
        Take.Recording({
          takeNumber,
          elapsedSeconds: take.elapsedSeconds,
          levelDb: take.levelDb,
          maybeOnsetSeconds: Option.some(onsetSeconds),
        }),
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

// A take kept in the history is the moment to ask the browser to keep
// the history too.
export const succeededAnalyseTake = (
  model: Model,
  takeNumber: number,
  result: TakeResult,
): TakeUpdate =>
  isTakeIn(model.take, ['Analysing'], takeNumber)
    ? moveTo(
        model,
        Take.ShowingResult({ takeNumber, result }),
        ...(result._tag === 'Tracked' && result.kept._tag === 'Kept'
          ? [AskToPersistStorage()]
          : []),
      )
    : unchanged(model)

export const failedAnalyseTake = (
  model: Model,
  takeNumber: number,
  reason: string,
): TakeUpdate =>
  isTakeIn(model.take, ['Analysing'], takeNumber)
    ? moveTo(model, Take.AnalysisFailed({ reason }))
    : unchanged(model)

// LISTENING AGAIN

// The finished take a state shows, if any, to come back to after
// listening.
const finishedTakeOf = (take: Take): Option.Option<FinishedTake> =>
  Match.value(take).pipe(
    Match.tag('ShowingResult', ({ takeNumber, result }) =>
      Option.some({ takeNumber, result }),
    ),
    Match.tag('Listening', ({ maybeTake }) => maybeTake),
    Match.orElse(() => Option.none()),
  )

// Whether `voice` can be listened to from here: the line once its curve
// is ready, the take once one has finished, and either's worst stretch
// once a take has been scored; never during a take.
export const canListenTo = (
  model: Model,
  voice: Voice,
  extent: Extent = 'Whole',
): boolean => {
  const maybeFinished = finishedTakeOf(model.take)
  return (
    canStartTake(model.take) &&
    (voice === 'Line'
      ? model.native._tag === 'Ready'
      : Option.isSome(maybeFinished)) &&
    (extent === 'Whole' ||
      Option.isSome(
        Option.flatMap(maybeFinished, ({ result }) => worstStretchOf(result)),
      ))
  )
}

// Listening changes no focus: the control that started it stays where it
// is, and says it now stops it.
export const clickedListen = (
  model: Model,
  voice: Voice,
  extent: Extent,
): TakeUpdate =>
  canListenTo(model, voice, extent)
    ? {
        model: modifyFields(model, {
          take: () =>
            Take.Listening({
              voice,
              extent,
              maybeTake: finishedTakeOf(model.take),
            }),
          maybePlaybackFailure: () => Option.none(),
        }),
      }
    : unchanged(model)

const backFromListening = (
  model: Model,
  maybeTake: Option.Option<FinishedTake>,
): Model =>
  modifyFields(model, {
    take: () =>
      Option.match(maybeTake, {
        onNone: () => Take.Idle(),
        onSome: ({ takeNumber, result }) =>
          Take.ShowingResult({ takeNumber, result }),
      }),
  })

export const clickedStopListening = (model: Model): TakeUpdate =>
  model.take._tag === 'Listening'
    ? { model: backFromListening(model, model.take.maybeTake) }
    : unchanged(model)

export const endedListening = (
  model: Model,
  voice: Voice,
  extent: Extent,
): TakeUpdate =>
  model.take._tag === 'Listening' &&
  model.take.voice === voice &&
  model.take.extent === extent
    ? { model: backFromListening(model, model.take.maybeTake) }
    : unchanged(model)

// A voice that would not play: the line before a take ends the take, and
// listening ends; either way the screen says why.
export const failedPlayback = (model: Model, reason: string): TakeUpdate => {
  const failed = modifyFields(model, {
    maybePlaybackFailure: () => Option.some(reason),
  })
  return Match.value(model.take).pipe(
    Match.tag('PlayingNative', () => moveTo(failed, Take.Idle())),
    Match.tag('Listening', ({ maybeTake }) => ({
      model: backFromListening(failed, maybeTake),
    })),
    Match.orElse(() => unchanged(model)),
  )
}

// Leaving the line abandons its take, finished or not, which releases
// its microphone and tracker; its audio is forgotten by the caller.
export const leftLine = (model: Model): Model =>
  modifyFields(model, { take: () => Take.Idle() })
