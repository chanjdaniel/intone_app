import { Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { TakeCurve, TakeFeatures } from '../take/take'
import { PracticeLine } from './lines'

// The practice screen's line: what it is and where its audio is, and its
// native curve and features, which are tracked once on the device, then
// read from it (../../services/native-curves.ts), or for a line of the
// learner's clip read from the history (../../services/history-clips.ts).

const clipId = Schema.String
const lineId = Schema.String

// Why a line has no native curve: there is no such line on this device,
// or there is and its curve could not be found or read.
export const NativeFailure = Schema.Literals(['NoSuchLine', 'Failed'])
export type NativeFailure = typeof NativeFailure.Type

export const NativeCurve = defineTaggedUnion({
  // No line is open.
  NoLine: {},
  Loading: { clipId, lineId },
  Ready: {
    clipId,
    lineId,
    line: PracticeLine,
    curve: TakeCurve,
    features: TakeFeatures,
  },
  Failed: { clipId, lineId, failure: NativeFailure, reason: Schema.String },
})
export type NativeCurve = typeof NativeCurve.Type

// How fast the line plays when listened to again. The line before a take
// always plays at its own speed, so the take copies its real timing.
export const listenSpeeds = [1, 0.75, 0.5] as const
export const ListenSpeed = Schema.Literals(listenSpeeds)
export type ListenSpeed = typeof ListenSpeed.Type

export const isNativeFor = (
  native: NativeCurve,
  clip: string,
  line: string,
): boolean =>
  native._tag !== 'NoLine' && native.clipId === clip && native.lineId === line
