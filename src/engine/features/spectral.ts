import type { Features } from '../../score/features'
import { frameCount, swiftF0Hop, swiftF0SampleRate } from '../pitch/swift-f0'
import { createRealFft } from './fft'

// Spectral features for the aligner, on SwiftF0's frames: each 16 ms
// frame is the 32 ms of 16 kHz audio centred on it (the window the
// curve's level is measured over), Hann windowed, its power summed into
// mel bands and logged.
//
// The aligner never looks at pitch (report section 3). These bands
// describe the spectrum's envelope, the vowel and the consonant; on the
// fixtures, aligning on them leaves a wrong accent's pitch part close to
// where aligning by the labelled mora boundaries leaves it, so they do
// not warp one accent onto another (docs/score.md, "The aligner"). The score
// normalises each band over the take, which takes out the microphone's
// and the voice's own colouring.

export type SpectralOptions = Readonly<{
  bands: number
  lowHz: number
  highHz: number
}>

// Chosen on the fixtures by scripts/score-study.ts (docs/score.md, "The
// aligner"): log mel bands lined the morae up better than cepstra, and
// 24 bands over 100 to 7600 Hz as well as 40, and a little better than
// the telephone band alone.
export const spectralOptions: SpectralOptions = {
  bands: 24,
  lowHz: 100,
  highHz: 7600,
}

const windowSize = swiftF0Hop * 2
// The power a band never reads below, so digital silence has a finite
// log: some 140 dB under a full-scale sine's band, far under any
// microphone's own noise.
const powerFloor = 1e-10

const melOf = (hz: number): number => 2595 * Math.log10(1 + hz / 700)
const hzOfMel = (mel: number): number => 700 * (10 ** (mel / 2595) - 1)

// Each band's weight per FFT bin: triangles, evenly spaced in mel, each
// rising from the last band's centre and falling to the next one's.
const melWeights = (
  options: SpectralOptions,
): ReadonlyArray<Readonly<{ first: number; weights: Float32Array }>> => {
  const bins = windowSize / 2 + 1
  const binHz = swiftF0SampleRate / windowSize
  const low = melOf(options.lowHz)
  const high = melOf(options.highHz)
  const edges = Array.from({ length: options.bands + 2 }, (_, k) =>
    hzOfMel(low + ((high - low) * k) / (options.bands + 1)),
  )
  return Array.from({ length: options.bands }, (_, band) => {
    const from = edges[band] ?? 0
    const centre = edges[band + 1] ?? 0
    const to = edges[band + 2] ?? 0
    const first = Math.max(0, Math.ceil(from / binHz))
    const last = Math.min(bins - 1, Math.floor(to / binHz))
    const weights = new Float32Array(Math.max(0, last - first + 1))
    for (let bin = first; bin <= last; bin++) {
      const hz = bin * binHz
      weights[bin - first] =
        hz <= centre ? (hz - from) / (centre - from) : (to - hz) / (to - centre)
    }
    return { first, weights }
  })
}

export const spectralFeatures = (
  samples16k: Float32Array,
  options: SpectralOptions = spectralOptions,
): Features => {
  const frames = frameCount(samples16k.length)
  const dims = options.bands
  const data = new Float32Array(frames * dims)
  const fft = createRealFft(windowSize)
  const bands = melWeights(options)
  const hann = Float32Array.from(
    { length: windowSize },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / windowSize),
  )
  const frame = new Float32Array(windowSize)
  const power = new Float32Array(windowSize / 2 + 1)
  for (let f = 0; f < frames; f++) {
    const start = (f - 1) * swiftF0Hop
    for (let i = 0; i < windowSize; i++) {
      frame[i] = (samples16k[start + i] ?? 0) * (hann[i] ?? 0)
    }
    fft.power(frame, power)
    let at = f * dims
    for (const { first, weights } of bands) {
      let sum = 0
      for (let w = 0; w < weights.length; w++) {
        sum += (weights[w] ?? 0) * (power[first + w] ?? 0)
      }
      data[at++] = Math.log10(sum + powerFloor)
    }
  }

  return { frameHz: swiftF0SampleRate / swiftF0Hop, dims, data }
}
