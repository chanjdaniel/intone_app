import type { Option } from 'effect'
import type { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import type { LineProgress } from '../level/progress'
import type { Message } from '../message'
import type { Model } from '../model'
import type { AppResourceServices } from '../resources'
import type { TakeCurve, TakeFeatures } from '../take/take'
import { LoadLinePlace, LoadNativeCurve } from './commands'
import type { PracticeLine } from './lines'
import { NativeCurve, type NativeFailure, isNativeFor } from './native'
import { LinePlace, type NextLine, isPlaceFor } from './place'

// The open line's native curve: asked for when the line opens, unless it
// is already in the Model, and again on request after a failure; and its
// place in its level, read each time it opens, since a take kept since
// may have moved its stars.

type LineUpdate = Update.Return<Model, Message, AppResourceServices>

const load = (model: Model, clipId: string, lineId: string): LineUpdate => ({
  model: modifyFields(model, {
    native: () => NativeCurve.Loading({ clipId, lineId }),
  }),
  commands: [LoadNativeCurve({ clipId, lineId })],
})

// The place a line opens with: what the Model has of it while it is read
// again, else nothing yet.
const placeOpening = (
  place: LinePlace,
  clipId: string,
  lineId: string,
): LinePlace =>
  place._tag === 'Ready' && isPlaceFor(place, clipId, lineId)
    ? place
    : LinePlace.Loading({ clipId, lineId })

export const openedLine = (
  model: Model,
  clipId: string,
  lineId: string,
): LineUpdate => {
  const placed = modifyFields(model, {
    place: place => placeOpening(place, clipId, lineId),
  })
  const native =
    isNativeFor(model.native, clipId, lineId) && model.native._tag !== 'Failed'
      ? { model: placed }
      : load(placed, clipId, lineId)
  return {
    model: native.model,
    commands: [...(native.commands ?? []), LoadLinePlace({ clipId, lineId })],
  }
}

export const succeededLoadLinePlace = (
  model: Model,
  clipId: string,
  lineId: string,
  levelName: string,
  progress: LineProgress,
  maybeNext: Option.Option<NextLine>,
): LineUpdate =>
  isPlaceFor(model.place, clipId, lineId)
    ? {
        model: modifyFields(model, {
          place: () =>
            LinePlace.Ready({ clipId, lineId, levelName, progress, maybeNext }),
        }),
      }
    : { model }

export const failedLoadLinePlace = (
  model: Model,
  clipId: string,
  lineId: string,
  reason: string,
): LineUpdate =>
  isPlaceFor(model.place, clipId, lineId)
    ? {
        model: modifyFields(model, {
          place: () => LinePlace.Failed({ clipId, lineId, reason }),
        }),
      }
    : { model }

export const succeededLoadNativeCurve = (
  model: Model,
  clipId: string,
  lineId: string,
  line: PracticeLine,
  curve: TakeCurve,
  features: TakeFeatures,
): LineUpdate =>
  model.native._tag === 'Loading' && isNativeFor(model.native, clipId, lineId)
    ? {
        model: modifyFields(model, {
          native: () =>
            NativeCurve.Ready({ clipId, lineId, line, curve, features }),
        }),
      }
    : { model }

export const failedLoadNativeCurve = (
  model: Model,
  clipId: string,
  lineId: string,
  failure: NativeFailure,
  reason: string,
): LineUpdate =>
  model.native._tag === 'Loading' && isNativeFor(model.native, clipId, lineId)
    ? {
        model: modifyFields(model, {
          native: () => NativeCurve.Failed({ clipId, lineId, failure, reason }),
        }),
      }
    : { model }

export const clickedRetryNativeCurve = (model: Model): LineUpdate =>
  model.native._tag === 'Failed'
    ? load(model, model.native.clipId, model.native.lineId)
    : { model }
