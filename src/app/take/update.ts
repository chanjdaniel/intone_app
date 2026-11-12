import { Match, Option } from 'effect'
import type { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import type { MicrophoneFailure } from '../../services/microphone'
import { type TakeOutcome, outcomeOf } from '../level/progress'
import { LinePlace, isPlaceFor } from '../line/place'
import type { Message } from '../message'
import type { Model } from '../model'
import type { AppResourceServices } from '../resources'
import { returnOutcomeOf } from '../returns/lineReturn'
import { AskToPersistStorage } from '../settings/commands'
import { AnalyseTake, FocusTakeControl, WaitForMicAnswer } from './commands'
import {
  type Extent,
  type FinishedTake,
  Take,
  type TakeMode,
  type TakeResult,
  type TakeScore,
  type Voice,
  canStartTake,
  levelMeterFloorDb,
  longestTakeSeconds,
  worstStretchOf,
} from './take'

// The take's transitions. Each is a fact about the take that update reads
// against the state the take is in; one that does not fit the state (a
// late timer, a result from an earlier take) leaves the Model as it is.

export type TakeUpdate = Update.Return<Model, Message, AppResourceServices>

const unchanged = (model: Model): TakeUpdate => ({ model })

// Moves to `take` and puts focus on its next control.
const moveTo = (
  model: Model,
  take: Take,
  ...commands: Update.Commands<Message, AppResourceServices>
): TakeUpdate => ({
  model: modifyFields(model, { take: () => take }),
  commands: [...commands, FocusTakeControl()],
})

// A take, guided or blind, starts by playing the line, once its native
// curve is ready to compare with; the tracker loads while it plays.
export const clickedRecord = (model: Model, mode: TakeMode): TakeUpdate => {
  if (!canStartTake(model.take) || model.native._tag !== 'Ready') {
    return unchanged(model)
  }
  const takeNumber = model.takesStarted + 1
  return {
    model: modifyFields(model, {
      take: () => Take.PlayingNative({ takeNumber, mode, tracker: 'Loading' }),
      takesStarted: () => takeNumber,
      maybePlaybackFailure: () => Option.none(),
    }),
    commands: [FocusTakeControl()],
  }
}

const askForMicrophone = (
  model: Model,
  takeNumber: number,
  mode: TakeMode,
): TakeUpdate =>
  moveTo(
    model,
    Take.AwaitingMic({ takeNumber, mode }),
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
    ? askForMicrophone(model, takeNumber, take.mode)
    : moveTo(model, Take.Preparing({ takeNumber, mode: take.mode }))
}

// The take has ended: it is tracked, then scored against the line's
// native curve, which a take never starts without, and kept in the
// history under its line, as guided or blind.
const analyse = (
  model: Model,
  takeNumber: number,
  mode: TakeMode,
): TakeUpdate => {
  const native = model.native
  if (native._tag !== 'Ready') {
    return moveTo(
      model,
      Take.AnalysisFailed({ reason: "The line's curve is not loaded." }),
    )
  }
  return moveTo(
    model,
    Take.Analysing({ takeNumber, mode }),
    AnalyseTake({
      takeNumber,
      mode,
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
    ? analyse(model, model.take.takeNumber, model.take.mode)
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
    Match.tag('Preparing', ({ takeNumber, mode }) =>
      askForMicrophone(model, takeNumber, mode),
    ),
    Match.tag('PlayingNative', ({ takeNumber, mode }) => ({
      model: modifyFields(model, {
        take: () => Take.PlayingNative({ takeNumber, mode, tracker: 'Ready' }),
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
    ? moveTo(
        model,
        Take.MicPromptIgnored({ takeNumber, mode: model.take.mode }),
      )
    : unchanged(model)

const isAsking = (
  take: Take,
): take is Extract<Take, { _tag: 'AwaitingMic' | 'MicPromptIgnored' }> =>
  take._tag === 'AwaitingMic' || take._tag === 'MicPromptIgnored'

export const acquiredMicrophone = (model: Model): TakeUpdate =>
  isAsking(model.take)
    ? moveTo(
        model,
        Take.Recording({
          takeNumber: model.take.takeNumber,
          mode: model.take.mode,
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
    return analyse(model, takeNumber, take.mode)
  }
  return {
    model: modifyFields(model, {
      take: () =>
        Take.Recording({
          takeNumber,
          mode: take.mode,
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
          mode: take.mode,
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

// A kept take's place after it: the line's stars, best and next return
// moved by it, and what it did for them.
const movedPlace = (
  place: Extract<LinePlace, { _tag: 'Ready' }>,
  mode: TakeMode,
  score: TakeScore,
  day: string,
) => {
  const returned = returnOutcomeOf(place.maybeReturn, { mode, score, day })
  const moved = outcomeOf(place.progress, mode, score, returned.note)
  return {
    outcome: moved.outcome,
    place: LinePlace.Ready({
      ...place,
      progress: moved.after,
      today: day,
      maybeReturn: returned.after,
    }),
  }
}

// A take kept in the history moves its line's stars and best, when the
// line's are known, and is the moment to ask the browser to keep the
// history too.
export const succeededAnalyseTake = (
  model: Model,
  takeNumber: number,
  result: TakeResult,
): TakeUpdate => {
  const take = model.take
  if (take._tag !== 'Analysing' || take.takeNumber !== takeNumber) {
    return unchanged(model)
  }
  const place = model.place
  const native = model.native
  const kept = result._tag === 'Tracked' && result.kept._tag === 'Kept'
  const maybeMoved =
    result._tag === 'Tracked' &&
    result.kept._tag === 'Kept' &&
    place._tag === 'Ready' &&
    native._tag === 'Ready' &&
    isPlaceFor(place, native.clipId, native.lineId)
      ? Option.some(movedPlace(place, take.mode, result.score, result.kept.day))
      : Option.none()
  const placed = Option.match(maybeMoved, {
    onNone: () => model,
    onSome: moved => modifyFields(model, { place: () => moved.place }),
  })
  const maybeOutcome: Option.Option<TakeOutcome> = Option.map(
    maybeMoved,
    moved => moved.outcome,
  )
  return moveTo(
    placed,
    Take.ShowingResult({ takeNumber, mode: take.mode, result, maybeOutcome }),
    ...(kept ? [AskToPersistStorage()] : []),
  )
}

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
    Match.tag('ShowingResult', ({ takeNumber, mode, result, maybeOutcome }) =>
      Option.some({ takeNumber, mode, result, maybeOutcome }),
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
        onSome: finished => Take.ShowingResult(finished),
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
// its microphone and tracker, and what would not play there; its audio is
// forgotten by the caller.
export const leftLine = (model: Model): Model =>
  modifyFields(model, {
    take: () => Take.Idle(),
    maybePlaybackFailure: () => Option.none(),
  })
