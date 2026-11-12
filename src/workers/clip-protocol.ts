import { Schema } from 'effect'

import {
  Samples,
  payloadTransferables,
  recordingPayloadFields,
} from './recording-payload'

// The clip Worker's protocol: one Schema per message kind, decoded at the
// boundary once per message. The clip's audio and every curve travel
// transferred, never copied.

// The clip's rate, at which Silero VAD and SwiftF0 both run: every
// sample position in these messages counts at it.
export const clipSampleRate = 16_000

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

// The whole clip, mono at 16 kHz, kept for the line editor to track its
// lines again from (`Track`); answered by `Held`, with its waveform.
export const Hold = Schema.TaggedStruct('Hold', { samples: Samples })

// The lines at these spans of the held clip, each tracked as a cut line
// is; answered by `TrackDone` with the same `request`.
export const Track = Schema.TaggedStruct('Track', {
  request: Schema.Finite,
  // Samples of the 16 kHz clip, from `from` up to `to`.
  spans: Schema.Array(
    Schema.Struct({ from: Schema.Finite, to: Schema.Finite }),
  ),
})

// Stop at once, whatever is under way, free the models and close.
export const Close = Schema.TaggedStruct('Close', {})

export const ToClip = Schema.Union([Load, Cut, Hold, Track, Close])
export type ToClip = typeof ToClip.Type

// FROM THE WORKER

export const Loaded = Schema.TaggedStruct('Loaded', {})

export const Progress = Schema.TaggedStruct('Progress', {
  step: Schema.Literals(['FindingLines', 'TrackingLines']),
  done: Schema.Finite,
  total: Schema.Finite,
})
export type Progress = typeof Progress.Type

// How far a line's curve can be trusted (../engine/cut/quality.ts).
export const LineQuality = Schema.Struct({
  speechFrames: Schema.Finite,
  confidentShare: Schema.Finite,
  pauseFrames: Schema.Finite,
  pausePitchedShare: Schema.Finite,
})

// A line's native curve as a recording payload (./recording-payload.ts),
// as the tracker Worker sends a take's, and its quality.
export const LineCurve = Schema.TaggedStruct('Tracked', {
  ...recordingPayloadFields,
  quality: LineQuality,
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

// The clip is held, and this is its waveform (../engine/audio/peaks.ts).
export const Held = Schema.TaggedStruct('Held', {
  peaks: Schema.instanceOf(Uint8Array<ArrayBufferLike>),
})

export const TrackDone = Schema.TaggedStruct('TrackDone', {
  request: Schema.Finite,
  lines: Schema.Array(CutLine),
})

export const Failed = Schema.TaggedStruct('Failed', { reason: Schema.String })

// The Worker has released its models and is about to close itself.
export const Closed = Schema.TaggedStruct('Closed', {})

export const FromClip = Schema.Union([
  Loaded,
  Progress,
  CutDone,
  Held,
  TrackDone,
  Failed,
  Closed,
])
export type FromClip = typeof FromClip.Type

// The arrays a message carries, to transfer rather than copy.
export const transferables = (
  message: ToClip | FromClip,
): ReadonlyArray<Transferable> => {
  if (message._tag === 'Cut' || message._tag === 'Hold') {
    return [message.samples.buffer]
  }
  if (message._tag === 'Held') {
    return [message.peaks.buffer]
  }
  if (message._tag === 'CutDone' || message._tag === 'TrackDone') {
    // NOTE: a buffer named twice in a transfer list throws, so each is
    // named once even if two arrays share one.
    return [
      ...new Set(
        message.lines.flatMap(({ curve }) =>
          curve._tag === 'Tracked' ? payloadTransferables(curve) : [],
        ),
      ),
    ]
  }
  return []
}
