import { Schema } from 'effect'

import { Samples } from './recording-payload'

// The text Worker's protocol (./text.worker.ts): one Schema per message
// kind, decoded at the boundary once per message. The clip's audio
// travels transferred, never copied.

// The rate Whisper reads at, at which the clip's audio is sent.
export const textSampleRate = 16_000

// A file of a model, below its directory, and its size from models.json.
export const ModelFile = Schema.Struct({
  path: Schema.String,
  bytes: Schema.Finite,
})

// A model as Transformers.js loads it: `<id>/<version>` below the
// models' root (`virtual:intone/models`), and the files it loads.
export const TextModel = Schema.Struct({
  name: Schema.String,
  files: Schema.Array(ModelFile),
})
export type TextModel = typeof TextModel.Type

export const Span = Schema.Struct({ from: Schema.Finite, to: Schema.Finite })

// TO THE WORKER

export const Load = Schema.TaggedStruct('Load', {
  // The models' root and Transformers.js's ONNX Runtime files, all on
  // the app's own origin, from the build.
  modelsRoot: Schema.String,
  wasm: Schema.String,
  mjs: Schema.String,
})

// Every file of the model kept on the device, fetched once: answered by
// `Downloaded`.
export const Download = Schema.TaggedStruct('Download', { model: TextModel })

// The clip, mono at 16 kHz, read window by window (seconds from its
// start, ../engine/text/windows.ts): answered by `Transcribed`.
export const Transcribe = Schema.TaggedStruct('Transcribe', {
  model: TextModel,
  samples: Samples,
  windows: Schema.Array(Span),
})

// Stop at once, whatever is under way, free the model and close.
export const Close = Schema.TaggedStruct('Close', {})

export const ToText = Schema.Union([Load, Download, Transcribe, Close])
export type ToText = typeof ToText.Type

// FROM THE WORKER

export const Loaded = Schema.TaggedStruct('Loaded', {})

export const Progress = Schema.TaggedStruct('Progress', {
  // Bytes of the model fetched, the model's sessions being made, or
  // windows read.
  step: Schema.Literals(['Downloading', 'Preparing', 'Transcribing']),
  done: Schema.Finite,
  total: Schema.Finite,
})
export type Progress = typeof Progress.Type

export const Downloaded = Schema.TaggedStruct('Downloaded', {})

export const Device = Schema.Literals(['WebGpu', 'Wasm'])
export type Device = typeof Device.Type

export const Piece = Schema.Struct({
  text: Schema.String,
  from: Schema.Finite,
  to: Schema.Finite,
})

export const Transcribed = Schema.TaggedStruct('Transcribed', {
  // Where the encoder ran: the GPU through WebGPU, or the CPU.
  device: Device,
  pieces: Schema.Array(Piece),
})

export const Failed = Schema.TaggedStruct('Failed', { reason: Schema.String })

// The Worker has released its model and is about to close itself.
export const Closed = Schema.TaggedStruct('Closed', {})

export const FromText = Schema.Union([
  Loaded,
  Progress,
  Downloaded,
  Transcribed,
  Failed,
  Closed,
])
export type FromText = typeof FromText.Type

// The arrays a message carries, to transfer rather than copy.
export const transferables = (
  message: ToText | FromText,
): ReadonlyArray<Transferable> =>
  message._tag === 'Transcribe' ? [message.samples.buffer] : []
