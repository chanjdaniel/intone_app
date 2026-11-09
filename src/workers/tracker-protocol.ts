import { Schema } from 'effect'

// The tracker Worker's protocol: one Schema per message kind, decoded at
// the boundary once per message, so once per 20 ms batch and never per
// sample. Sample and curve arrays travel transferred, never copied.

const Samples = Schema.instanceOf(Float32Array<ArrayBufferLike>)

// TO THE WORKER

export const Load = Schema.TaggedStruct('Load', {
  // The SwiftF0 model's URL and ONNX Runtime's WebAssembly directory, both
  // on the app's own origin, from the build's URL maps.
  modelUrl: Schema.String,
  wasmPaths: Schema.String,
})

// The take starts: the batches to come are at `sampleRate`, the capture's
// AudioContext rate.
export const Start = Schema.TaggedStruct('Start', {
  sampleRate: Schema.Finite,
})

export const Batch = Schema.TaggedStruct('Batch', { samples: Samples })

export const Finish = Schema.TaggedStruct('Finish', {})

export const Close = Schema.TaggedStruct('Close', {})

export const ToTracker = Schema.Union([Load, Start, Batch, Finish, Close])
export type ToTracker = typeof ToTracker.Type

// FROM THE WORKER

export const Loaded = Schema.TaggedStruct('Loaded', {})

export const Tracked = Schema.TaggedStruct('Tracked', {
  frameHz: Schema.Finite,
  f0Hz: Samples,
  confidence: Samples,
  levelDb: Samples,
  onsetFrame: Schema.Finite,
  peakDb: Schema.Finite,
  gainDb: Schema.Finite,
})

export const TooQuiet = Schema.TaggedStruct('TooQuiet', {
  peakDb: Schema.Finite,
})

export const TooNoisy = Schema.TaggedStruct('TooNoisy', {
  peakDb: Schema.Finite,
})

export const Failed = Schema.TaggedStruct('Failed', { reason: Schema.String })

// The Worker has released its model and is about to close itself.
export const Closed = Schema.TaggedStruct('Closed', {})

export const FromTracker = Schema.Union([
  Loaded,
  Tracked,
  TooQuiet,
  TooNoisy,
  Failed,
  Closed,
])
export type FromTracker = typeof FromTracker.Type

// What a finished take comes back as.
export type TrackerResult =
  | typeof Tracked.Type
  | typeof TooQuiet.Type
  | typeof TooNoisy.Type

// The arrays a message carries, to transfer rather than copy.
export const transferables = (
  message: ToTracker | FromTracker,
): ReadonlyArray<Transferable> => {
  if (message._tag === 'Batch') {
    return [message.samples.buffer]
  }
  if (message._tag === 'Tracked') {
    return [
      message.f0Hz.buffer,
      message.confidence.buffer,
      message.levelDb.buffer,
    ]
  }
  return []
}
