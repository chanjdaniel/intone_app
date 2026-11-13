// The conditions a fixture is also written in: room noise mixed under the
// speech, and a phone-like band. Plain arithmetic on typed arrays, so the
// same input gives the same bytes every run.

// A stretch of samples, [from, to).
export type Span = Readonly<{ from: number; to: number }>

export const rmsOf = (
  samples: Float32Array,
  spans: ReadonlyArray<Span> = [{ from: 0, to: samples.length }],
): number => {
  let sum = 0
  let count = 0
  for (const { from, to } of spans) {
    for (let n = Math.max(0, from); n < Math.min(to, samples.length); n++) {
      const sample = samples[n] ?? 0
      sum += sample * sample
      count++
    }
  }
  return count === 0 ? 0 : Math.sqrt(sum / count)
}

export const toMono = (channels: ReadonlyArray<Float32Array>): Float32Array => {
  const length = channels[0]?.length ?? 0
  const mono = new Float32Array(length)
  for (let n = 0; n < length; n++) {
    let sum = 0
    for (const channel of channels) {
      sum += channel[n] ?? 0
    }
    mono[n] = sum / channels.length
  }
  return mono
}

export type NoiseMix = Readonly<{
  // Speech over noise, in dB, both measured over `speechSpans`.
  snrDb: number
  // Where in the noise recording the file's first sample takes its noise.
  offset: number
  // The stretches that hold speech, which the speech level is read over.
  speechSpans: ReadonlyArray<Span>
}>

// The speech with a stretch of the noise added under it, the noise scaled
// so speech stands `snrDb` above it.
export const mixNoise = (
  speech: Float32Array,
  noise: Float32Array,
  { snrDb, offset, speechSpans }: NoiseMix,
): Readonly<{ samples: Float32Array; noiseGain: number }> => {
  if (offset < 0 || offset + speech.length > noise.length) {
    throw new RangeError(
      `The noise is too short: ${speech.length} samples from ${offset} need ${offset + speech.length}, and it has ${noise.length}.`,
    )
  }
  const stretch = noise.subarray(offset, offset + speech.length)
  const noiseGain =
    rmsOf(speech, speechSpans) /
    (rmsOf(stretch, speechSpans) * 10 ** (snrDb / 20))
  const samples = new Float32Array(speech.length)
  for (let n = 0; n < speech.length; n++) {
    samples[n] = (speech[n] ?? 0) + noiseGain * (stretch[n] ?? 0)
  }
  return { samples, noiseGain }
}

// The telephone band, 300 to 3400 Hz (ITU-T G.712's passband).
export const phoneBandHz = { low: 300, high: 3400 } as const

// The Q of each second-order section of a fourth-order Butterworth filter.
const butterworthQs = [0.5411961, 1.306563] as const

type Section = Readonly<{
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}>

// A second-order section from the Audio EQ Cookbook (Bristow-Johnson).
const section = (
  kind: 'lowpass' | 'highpass',
  hz: number,
  q: number,
  sampleRate: number,
): Section => {
  const w = (2 * Math.PI * hz) / sampleRate
  const cos = Math.cos(w)
  const alpha = Math.sin(w) / (2 * q)
  const a0 = 1 + alpha
  const b1 = kind === 'lowpass' ? 1 - cos : -(1 + cos)
  const b0 = Math.abs(b1) / 2
  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b0 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  }
}

const runSection = (
  input: Float64Array<ArrayBuffer>,
  s: Section,
): Float64Array<ArrayBuffer> => {
  const output = new Float64Array(input.length)
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let n = 0; n < input.length; n++) {
    const x = input[n] ?? 0
    const y = s.b0 * x + s.b1 * x1 + s.b2 * x2 - s.a1 * y1 - s.a2 * y2
    x2 = x1
    x1 = x
    y2 = y1
    y1 = y
    output[n] = y
  }
  return output
}

// The speech as a phone passes it: fourth-order Butterworth high-pass at
// 300 Hz and low-pass at 3400 Hz, run forward only, as a real line is.
// Its phase delay is under a millisecond across the band.
export const phoneBand = (
  samples: Float32Array,
  sampleRate: number,
): Float32Array => {
  let signal: Float64Array<ArrayBuffer> = Float64Array.from(samples)
  for (const q of butterworthQs) {
    signal = runSection(
      signal,
      section('highpass', phoneBandHz.low, q, sampleRate),
    )
  }
  for (const q of butterworthQs) {
    signal = runSection(
      signal,
      section('lowpass', phoneBandHz.high, q, sampleRate),
    )
  }
  return Float32Array.from(signal)
}
