// The plain SwiftF0 loop: frame 16 kHz audio into the model's windows,
// run the model on each, stitch the frames back, gate digital silence and
// measure each frame's level. It follows SwiftF0 0.3.0's own `detect`
// (`swift_f0/core.py` at commit d1ba77fe, the model in models.json), so a
// curve here is the curve SwiftF0's authors' code gives for the same
// 16 kHz audio.
//
// The model runs elsewhere: `infer` is ONNX Runtime in the tracker
// Worker, or a stand-in in tests.

export const swiftF0SampleRate = 16_000
// One frame per 256 samples: 16 ms, 62.5 frames a second.
export const swiftF0Hop = 256
export const swiftF0FrameHz = swiftF0SampleRate / swiftF0Hop
export const swiftF0MinHz = 46.875
export const swiftF0MaxHz = 2093.75
// The model's receptive field reaches 10 frames ahead and 11 behind, so a
// window with that much context either side gives the frames inside it
// exactly as one run over the whole recording would.
const lookaheadFrames = 10
const leftFrames = 11
// Frames per model run: 30 s.
const windowFrames = 1875
// A frame whose audio peaks below this (-60 dBFS) is digital silence,
// which the model never saw and answers with random voiced frames; it
// gets confidence 0.
const silencePeak = 1e-3
// The level floor, -140 dBFS, for a frame of exact zeros.
const levelFloor = 1e-7

// One model run: 16 kHz samples in, a pitch and a confidence per frame
// out, for pitches between `minHz` and `maxHz`.
export type SwiftF0Inference = (
  samples: Float32Array,
  minHz: number,
  maxHz: number,
) => Promise<
  Readonly<{ pitchHz: ArrayLike<number>; confidence: ArrayLike<number> }>
>

export type SwiftF0Frames = Readonly<{
  pitchHz: Float32Array
  confidence: Float32Array
  // The RMS of the 32 ms centred on each frame, in dBFS.
  levelDb: Float32Array
}>

export const frameCount = (sampleCount: number): number =>
  Math.max(1, Math.floor(sampleCount / swiftF0Hop))

// Tracks a whole recording at 16 kHz.
export const trackFrames = async (
  samples: Float32Array,
  infer: SwiftF0Inference,
): Promise<SwiftF0Frames> => {
  if (samples.length === 0) {
    throw new RangeError('there is no audio to track')
  }
  const frames = frameCount(samples.length)
  const pitchHz = new Float32Array(frames)
  const confidence = new Float32Array(frames)

  for (let start = 0; start < frames; start += windowFrames) {
    const end = Math.min(start + windowFrames, frames)
    const left = Math.max(0, start - leftFrames)
    const window =
      end < frames
        ? samples.subarray(
            left * swiftF0Hop,
            (end + lookaheadFrames) * swiftF0Hop,
          )
        : samples.subarray(left * swiftF0Hop)
    const result = await infer(window, swiftF0MinHz, swiftF0MaxHz)
    for (let frame = start; frame < end; frame++) {
      pitchHz[frame] = result.pitchHz[frame - left] ?? 0
      confidence[frame] = result.confidence[frame - left] ?? 0
    }
  }

  const levelDb = new Float32Array(frames)
  let previousPower = 0
  for (let frame = 0; frame < frames; frame++) {
    const from = frame * swiftF0Hop
    const to = samples.length < swiftF0Hop ? samples.length : from + swiftF0Hop
    let peak = 0
    let power = 0
    for (let i = from; i < to; i++) {
      const sample = samples[i] ?? 0
      peak = Math.max(peak, Math.abs(sample))
      power += sample * sample
    }
    if (peak < silencePeak) {
      confidence[frame] = 0
    }
    levelDb[frame] =
      20 *
      Math.log10(Math.max(Math.sqrt((previousPower + power) / 512), levelFloor))
    previousPower = power
  }

  return { pitchHz, confidence, levelDb }
}
