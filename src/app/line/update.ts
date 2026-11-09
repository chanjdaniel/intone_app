import type { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import type { Message } from '../message'
import type { Model } from '../model'
import type { AppResourceServices } from '../resources'
import type { TakeCurve, TakeFeatures } from '../take/take'
import { LoadNativeCurve } from './commands'
import type { PracticeLine } from './lines'
import { NativeCurve, type NativeFailure, isNativeFor } from './native'

// The open line's native curve: asked for when the line opens, unless it
// is already in the Model, and again on request after a failure.

type LineUpdate = Update.Return<Model, Message, AppResourceServices>

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
  isNativeFor(model.native, clipId, lineId) && model.native._tag !== 'Failed'
    ? { model }
    : load(model, clipId, lineId)

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
