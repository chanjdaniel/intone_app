import { Schema } from 'effect'

import type { Curve } from '../score/curve'
import type { Features } from '../score/features'
import type { Recording } from '../score/score'

// A tracked recording as a Worker sends it back, a take's
// (./tracker-protocol.ts, `Tracked`) or a clip line's
// (./clip-protocol.ts, `LineCurve`): its pitch curve, and the spectral
// features of the same audio on the same frames, for the score's aligner
// (`featureDims` values per frame, frame by frame). Its arrays are
// transferred, never copied.

export const Samples = Schema.instanceOf(Float32Array<ArrayBufferLike>)

export const recordingPayloadFields = {
  frameHz: Schema.Finite,
  f0Hz: Samples,
  confidence: Samples,
  levelDb: Samples,
  onsetFrame: Schema.Finite,
  featureDims: Schema.Finite,
  features: Samples,
}

const RecordingPayload = Schema.Struct(recordingPayloadFields)
export type RecordingPayload = typeof RecordingPayload.Type

// The payload of a curve and its features, in a Worker.
export const payloadOf = (
  curve: Curve,
  features: Pick<Features, 'dims' | 'data'>,
): RecordingPayload => ({
  frameHz: curve.frameHz,
  f0Hz: curve.f0Hz,
  confidence: curve.confidence,
  levelDb: curve.levelDb,
  onsetFrame: curve.onsetFrame,
  featureDims: features.dims,
  features: features.data,
})

// The recording a payload carries, as the score reads it, on the page.
export const recordingOfPayload = (payload: RecordingPayload): Recording => ({
  curve: {
    frameHz: payload.frameHz,
    f0Hz: payload.f0Hz,
    confidence: payload.confidence,
    levelDb: payload.levelDb,
    onsetFrame: payload.onsetFrame,
  },
  features: {
    frameHz: payload.frameHz,
    dims: payload.featureDims,
    data: payload.features,
  },
})

// The arrays a payload carries, to transfer rather than copy.
export const payloadTransferables = (
  payload: RecordingPayload,
): ReadonlyArray<ArrayBufferLike> => [
  payload.f0Hz.buffer,
  payload.confidence.buffer,
  payload.levelDb.buffer,
  payload.features.buffer,
]
