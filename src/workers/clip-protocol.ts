import { Schema } from 'effect'

// The clip Worker's protocol: one Schema per message kind, decoded at the
// boundary once per message. The clip's audio and every curve travel
// transferred, never copied.

const Samples = Schema.instanceOf(Float32Array<ArrayBufferLike>)

// TO THE WORKER

export const Load = Schema.TaggedStruct('Load', {
  // Silero VAD's and SwiftF0's URLs and ONNX Runtime's WebAssembly
  // directory, all on the app's own origin, from the build's URL maps.
  speechModelUrl: Schema.String,
  pitchModelUrl: Schema.String,
  wasmPaths: Schema.String,
})

// The whole clip, mono at 16 kHz.
export const Cut = Schema.TaggedStruct('Cut', { samples: Samples })

// Stop at once, whatever is under way, free the models and close.
export const Close = Schema.TaggedStruct('Close', {})

export const ToClip = Schema.Union([Load, Cut, Close])
export type ToClip = typeof ToClip.Type

// FROM THE WORKER

export const Loaded = Schema.TaggedStruct('Loaded', {})

export const Progress = Schema.TaggedStruct('Progress', {
  step: Schema.Literals(['FindingLines', 'TrackingLines']),
  done: Schema.Finite,
  total: Schema.Finite,
})
export type Progress = typeof Progress.Type

// A line's native curve and the spectral features of the same audio, as
// the tracker Worker sends a take's (./tracker-protocol.ts, `Tracked`).
export const LineCurve = Schema.TaggedStruct('Tracked', {
  frameHz: Schema.Finite,
  f0Hz: Samples,
  confidence: Samples,
  levelDb: Samples,
  onsetFrame: Schema.Finite,
  featureDims: Schema.Finite,
  features: Samples,
})
export type LineCurve = typeof LineCurve.Type

export const CutLine = Schema.Struct({
  // Samples of the 16 kHz clip, from `from` up to `to`.
  from: Schema.Finite,
  to: Schema.Finite,
  curve: Schema.Union([
    LineCurve,
    Schema.TaggedStruct('TooQuiet', {}),
    Schema.TaggedStruct('TooNoisy', {}),
  ]),
})
export type CutLine = typeof CutLine.Type

export const CutDone = Schema.TaggedStruct('CutDone', {
  lines: Schema.Array(CutLine),
})

export const Failed = Schema.TaggedStruct('Failed', { reason: Schema.String })

// The Worker has released its models and is about to close itself.
export const Closed = Schema.TaggedStruct('Closed', {})

export const FromClip = Schema.Union([
  Loaded,
  Progress,
  CutDone,
  Failed,
  Closed,
])
export type FromClip = typeof FromClip.Type

// The arrays a message carries, to transfer rather than copy.
export const transferables = (
  message: ToClip | FromClip,
): ReadonlyArray<Transferable> => {
  if (message._tag === 'Cut') {
    return [message.samples.buffer]
  }
  if (message._tag === 'CutDone') {
    // NOTE: a buffer named twice in a transfer list throws, so each is
    // named once even if two arrays share one.
    return [
      ...new Set(
        message.lines.flatMap(({ curve }) =>
          curve._tag === 'Tracked'
            ? [
                curve.f0Hz.buffer,
                curve.confidence.buffer,
                curve.levelDb.buffer,
                curve.features.buffer,
              ]
            : [],
        ),
      ),
    ]
  }
  return []
}
