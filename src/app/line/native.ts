import { Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { TakeCurve, TakeFeatures } from '../take/take'

// The practice screen's line: its native curve and features, which are
// tracked once on the device, then read from it
// (../../services/native-curves.ts).

const clipId = Schema.String
const lineId = Schema.String

export const NativeCurve = defineTaggedUnion({
  // No line is open.
  NoLine: {},
  Loading: { clipId, lineId },
  Ready: { clipId, lineId, curve: TakeCurve, features: TakeFeatures },
  Failed: { clipId, lineId, reason: Schema.String },
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
