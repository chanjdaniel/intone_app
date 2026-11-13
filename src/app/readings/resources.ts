import { Effect, Option, Schema } from 'effect'
import { ManagedResource } from 'foldkit'

import { reasonOf } from '../../engine/reason'
import {
  Readings,
  ReadingsError,
  type ReadingsSession,
} from '../../services/readings'
import { Message } from '../message'
import type { Model } from '../model'
import { readingsTarget } from './readings'

// The readings' resource: the readings Worker with its dictionary loaded
// (../../services/readings.ts), held while a line with Japanese text is
// open with its readings shown, from one line to the next, and released
// the moment the learner hides them or leaves the practice screen, which
// frees the dictionary.

export const ReadingsResource =
  ManagedResource.tag<ReadingsSession>()('ReadingsResource')
export type ReadingsResourceService = ManagedResource.ServiceOf<
  typeof ReadingsResource
>

export const readingsResources = ManagedResource.make<Model, Message>()(
  entry => ({
    readings: entry(Schema.Option(Schema.Struct({})), {
      resource: ReadingsResource,
      modelToMaybeRequirements: model =>
        Option.map(readingsTarget(model), () => ({})),
      acquire: () =>
        Readings.use(readings => readings.open).pipe(
          Effect.provide(Readings.layer),
        ),
      release: () => Effect.void,
      onAcquired: () => Message.AcquiredReadings(),
      onReleased: () => Message.ReleasedReadings(),
      onAcquireError: error =>
        Message.FailedAcquireReadings({
          reason:
            error instanceof ReadingsError ? error.reason : reasonOf(error),
        }),
    }),
  }),
)
