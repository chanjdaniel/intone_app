import type { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import type { Message } from '../message'
import type { Model } from '../model'
import type { TakeResourceServices } from '../take/resources'
import type { TakeCurve, TakeFeatures } from '../take/take'
import { LoadNativeCurve, isKnownLine } from './commands'
import { NativeCurve, isNativeFor } from './native'

// The open line's native curve: asked for when the line opens, unless it
// is already in the Model, and again on request after a failure.

type LineUpdate = Update.Return<Model, Message, TakeResourceServices>

const load = (model: Model, clipId: string, lineId: string): LineUpdate => ({
  model: modifyFields(model, {
    native: () => NativeCurve.Loading({ clipId, lineId }),
  }),
  commands: [LoadNativeCurve({ clipId, lineId })],
})

export const openedLine = (
  model: Model,
  clipId: string,
  lineId: string,
): LineUpdate =>
  !isKnownLine(clipId, lineId) ||
  (isNativeFor(model.native, clipId, lineId) && model.native._tag !== 'Failed')
    ? { model }
    : load(model, clipId, lineId)

export const succeededLoadNativeCurve = (
  model: Model,
  clipId: string,
  lineId: string,
  curve: TakeCurve,
  features: TakeFeatures,
): LineUpdate =>
  model.native._tag === 'Loading' && isNativeFor(model.native, clipId, lineId)
    ? {
        model: modifyFields(model, {
          native: () => NativeCurve.Ready({ clipId, lineId, curve, features }),
        }),
      }
    : { model }

export const failedLoadNativeCurve = (
  model: Model,
  clipId: string,
  lineId: string,
  reason: string,
): LineUpdate =>
  model.native._tag === 'Loading' && isNativeFor(model.native, clipId, lineId)
    ? {
        model: modifyFields(model, {
          native: () => NativeCurve.Failed({ clipId, lineId, reason }),
        }),
      }
    : { model }

export const clickedRetryNativeCurve = (model: Model): LineUpdate =>
  model.native._tag === 'Failed'
    ? load(model, model.native.clipId, model.native.lineId)
    : { model }
