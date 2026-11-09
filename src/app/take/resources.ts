import { Effect, Option, Schema } from 'effect'
import { ManagedResource } from 'foldkit'

import {
  Microphone,
  MicrophoneError,
  type MicrophoneSession,
} from '../../services/microphone'
import { Tracker, type TrackerSession } from '../../services/tracker'
import { Message } from '../message'
import type { Model } from '../model'
import { takeNeedingMicrophone, takeNeedingTracker } from './take'

// The take's two resources, held exactly while the Model needs them: the
// tracker Worker from Preparing to Analysing, the microphone from
// AwaitingMic to Recording. Foldkit releases each the moment the Model
// leaves those states, by stop, by error or by leaving the screen, and a
// new take (a new take number) gets new ones.

export const TrackerResource =
  ManagedResource.tag<TrackerSession>()('TrackerResource')
export type TrackerResourceService = ManagedResource.ServiceOf<
  typeof TrackerResource
>

export const MicrophoneResource =
  ManagedResource.tag<MicrophoneSession>()('MicrophoneResource')
export type MicrophoneResourceService = ManagedResource.ServiceOf<
  typeof MicrophoneResource
>

export type TakeResourceServices =
  | TrackerResourceService
  | MicrophoneResourceService

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const TakeRequirements = Schema.Option(
  Schema.Struct({ takeNumber: Schema.Finite }),
)

const onHomeScreen = (model: Model): boolean => model.route._tag === 'Home'

export const managedResources = ManagedResource.make<Model, Message>()(
  entry => ({
    tracker: entry(TakeRequirements, {
      resource: TrackerResource,
      modelToMaybeRequirements: model =>
        takeNeedingTracker(model.take).pipe(
          Option.filter(() => onHomeScreen(model)),
          Option.map(takeNumber => ({ takeNumber })),
        ),
      acquire: () =>
        Effect.gen(function* () {
          const tracker = yield* Tracker
          return yield* tracker.open
        }).pipe(Effect.provide(Tracker.layer)),
      release: () => Effect.void,
      onAcquired: () => Message.AcquiredTracker(),
      onReleased: () => Message.ReleasedTracker(),
      onAcquireError: error =>
        Message.FailedAcquireTracker({ reason: reasonOf(error) }),
    }),

    microphone: entry(TakeRequirements, {
      resource: MicrophoneResource,
      modelToMaybeRequirements: model =>
        takeNeedingMicrophone(model.take).pipe(
          Option.filter(() => onHomeScreen(model)),
          Option.map(takeNumber => ({ takeNumber })),
        ),
      acquire: () =>
        Effect.gen(function* () {
          const microphone = yield* Microphone
          return yield* microphone.open
        }).pipe(Effect.provide(Microphone.layer)),
      release: () => Effect.void,
      onAcquired: () => Message.AcquiredMicrophone(),
      onReleased: () => Message.ReleasedMicrophone(),
      onAcquireError: error =>
        error instanceof MicrophoneError
          ? Message.FailedAcquireMicrophone({
              failure: error.failure,
              reason: error.message,
            })
          : Message.FailedAcquireMicrophone({
              failure: 'Failed',
              reason: reasonOf(error),
            }),
    }),
  }),
)
