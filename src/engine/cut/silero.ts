// The plain Silero VAD loop: 16 kHz audio in, one speech probability per
// 32 ms window out. It follows Silero VAD 6.2.3's own `OnnxWrapper` and
// `get_speech_timestamps` (`src/silero_vad/utils_vad.py` at the tag, the
// model in models.json): windows of 512 samples, each run with the 64
// samples before it and the state the last run left, the last window
// padded with zeros.
//
// The model runs elsewhere: `infer` is ONNX Runtime in the clip Worker,
// or a stand-in in tests.

export const sileroSampleRate = 16_000
export const sileroWindow = 512
export const sileroContext = 64
// The model's recurrent state: 2 x 1 x 128 values.
export const sileroStateSize = 256

// One model run: the window with its context before it (576 samples) and
// the state, in; the window's speech probability and the next state, out.
export type SileroInference = (
  input: Float32Array,
  state: Float32Array,
) => Promise<Readonly<{ probability: number; state: Float32Array }>>

export const windowCount = (sampleCount: number): number =>
  Math.ceil(sampleCount / sileroWindow)

// Each window's speech probability. `progress` hears how many windows of
// how many are done, now and then, so a long clip can show its progress;
// each call to it is awaited, which also lets a Worker read its messages.
export const speechProbabilities = async (
  samples: Float32Array,
  infer: SileroInference,
  progress?: (done: number, total: number) => Promise<void> | void,
): Promise<Float32Array> => {
  const total = windowCount(samples.length)
  const probabilities = new Float32Array(total)
  const input = new Float32Array(sileroContext + sileroWindow)
  // About 1% at a time, and at least every 10 s of audio.
  const every = Math.max(1, Math.min(Math.ceil(total / 100), 312))
  let state: Float32Array = new Float32Array(sileroStateSize)
  for (let k = 0; k < total; k += 1) {
    const from = k * sileroWindow
    input.copyWithin(0, sileroWindow)
    input.fill(0, sileroContext)
    input.set(
      samples.subarray(from, Math.min(from + sileroWindow, samples.length)),
      sileroContext,
    )
    const run = await infer(input, state)
    probabilities[k] = run.probability
    state = run.state
    if (progress !== undefined && ((k + 1) % every === 0 || k + 1 === total)) {
      await progress(k + 1, total)
    }
  }
  return probabilities
}
