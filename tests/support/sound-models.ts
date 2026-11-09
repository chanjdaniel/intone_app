import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as ort from 'onnxruntime-web/wasm'

import { type ModelFile, ensureCached } from '../../build/models.ts'
import { root } from './run.ts'

// The speech models ticket 20 measures for a sounds part of the score
// (docs/sounds.md), each the quantised ONNX file the app would download,
// at a pinned revision, checked by size and SHA-256 and cached in
// .cache/models/ as the build caches its own list.

export type SoundModel = ModelFile &
  Readonly<{
    // The model's frames per second, and the width of each.
    frameHz: number
    dims: number
    // The model's input: raw samples, or Whisper's log mel spectrogram.
    input: 'samples' | 'whisper-mel'
    // Raw samples scaled to mean 0 and variance 1 first, as the model's
    // own feature extractor does (its preprocessor_config.json).
    normalise: boolean
  }>

export const soundModels: ReadonlyArray<SoundModel> = [
  {
    id: 'whisper-base-encoder',
    name: "Whisper-base's encoder (q4)",
    file: 'encoder_model_q4.onnx',
    url: 'https://huggingface.co/onnx-community/whisper-base/resolve/27a07b4b52b3a4c5886134bb4320e93e1a4bbc7c/onnx/encoder_model_q4.onnx',
    bytes: 18_772_451,
    sha256: '9d4e9c31e8559e71de3e0e49d60b830951484699ef53747a4a06261bbbc8cb88',
    licence: 'MIT',
    source:
      'https://github.com/openai/whisper/tree/86098128c0b4f24f0e2aa2994de830614b474227',
    frameHz: 50,
    dims: 512,
    input: 'whisper-mel',
    normalise: false,
  },
  {
    id: 'wavlm-base-plus',
    name: 'WavLM-Base+ (int8)',
    file: 'model_quantized.onnx',
    url: 'https://huggingface.co/Xenova/wavlm-base-plus/resolve/27b8ee283bf6c3a5ae77d7e90d8e40a6925288e2/onnx/model_quantized.onnx',
    bytes: 95_421_869,
    sha256: '9629e437514e16880eacc868dde9db6f319fa0864fdbb95de61fd39af3dbfe89',
    licence: 'CC BY-SA 3.0',
    source:
      'https://huggingface.co/microsoft/wavlm-base-plus/tree/4c66d4806a428f2e922ccfa1a962776e232d487b',
    frameHz: 50,
    dims: 768,
    input: 'samples',
    normalise: false,
  },
  {
    // The same model unquantised: the int8 file's last layer collapses
    // to one vector on 20 of the 504 fixtures (docs/sounds.md), so this
    // tells the model from its quantisation.
    id: 'wavlm-base-plus-fp32',
    name: 'WavLM-Base+ (fp32)',
    file: 'model.onnx',
    url: 'https://huggingface.co/Xenova/wavlm-base-plus/resolve/27b8ee283bf6c3a5ae77d7e90d8e40a6925288e2/onnx/model.onnx',
    bytes: 377_935_358,
    sha256: '07789ad4d9e01cba75fce7fd923e7a5e9a0aaf0f43df25ba6ee6d3d6d7adaa1c',
    licence: 'CC BY-SA 3.0',
    source:
      'https://huggingface.co/microsoft/wavlm-base-plus/tree/4c66d4806a428f2e922ccfa1a962776e232d487b',
    frameHz: 50,
    dims: 768,
    input: 'samples',
    normalise: false,
  },
  {
    id: 'wavlm-large',
    name: 'WavLM-Large (q4)',
    file: 'model_q4.onnx',
    url: 'https://huggingface.co/onnx-community/wavlm-large-ONNX/resolve/92825d31dba8dc62841133fb88845d4c7fa7cfc2/onnx/model_q4.onnx',
    bytes: 326_680_448,
    sha256: 'a151d512792a7401bb6594c661cbf03c2fad99fbc91c6d8723064d770446797e',
    licence: 'CC BY-SA 3.0',
    source:
      'https://huggingface.co/microsoft/wavlm-large/tree/c1423ed94bb01d80a3f5ce5bc39f6026a0f4828c',
    frameHz: 50,
    dims: 1024,
    input: 'samples',
    normalise: true,
  },
]

export const soundModel = (id: string): SoundModel => {
  const model = soundModels.find(candidate => candidate.id === id)
  if (model === undefined) {
    throw new Error(`no sound model ${id}`)
  }
  return model
}

export const loadSoundModel = async (
  model: SoundModel,
): Promise<Uint8Array<ArrayBuffer>> =>
  readFileSync(await ensureCached(model, join(root, '.cache', 'models')))

// Whisper's log mel spectrogram (OpenAI's `whisper/audio.py`, which
// Transformers.js's WhisperFeatureExtractor follows): the samples padded
// with silence to 30 s, a 400-sample periodic Hann window every 160
// samples with reflected ends, 80 Slaney mel bands to 8 kHz, log10
// floored at 8 under the loudest, then (x + 4) / 4. 80 x 3000, band major.
const whisperSamples = 480_000
const whisperFft = 400
const whisperHop = 160
const whisperFrames = 3000
const whisperBands = 80

const slaneyMel = (hz: number): number =>
  hz < 1000 ? (3 * hz) / 200 : 15 + Math.log(hz / 1000) / (Math.log(6.4) / 27)
const slaneyHz = (mel: number): number =>
  mel < 15
    ? (200 * mel) / 3
    : 1000 * Math.exp(((mel - 15) * Math.log(6.4)) / 27)

const whisperFilters = ((): Float32Array => {
  const bins = whisperFft / 2 + 1
  const filters = new Float32Array(whisperBands * bins)
  const top = slaneyMel(8000)
  const edges = Array.from({ length: whisperBands + 2 }, (_, i) =>
    slaneyHz((top * i) / (whisperBands + 1)),
  )
  for (let band = 0; band < whisperBands; band++) {
    const low = edges[band] ?? 0
    const centre = edges[band + 1] ?? 0
    const high = edges[band + 2] ?? 0
    const norm = 2 / (high - low)
    for (let bin = 0; bin < bins; bin++) {
      const hz = (bin * 16_000) / whisperFft
      const weight = Math.max(
        0,
        Math.min((hz - low) / (centre - low), (high - hz) / (high - centre)),
      )
      filters[band * bins + bin] = weight * norm
    }
  }
  return filters
})()

export const whisperLogMel = (samples16k: Float32Array): Float32Array => {
  const padded = new Float32Array(whisperSamples)
  padded.set(samples16k.subarray(0, whisperSamples))
  const bins = whisperFft / 2 + 1
  const half = whisperFft / 2
  const window = Float32Array.from(
    { length: whisperFft },
    (_, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / whisperFft),
  )
  const cos = new Float32Array(bins * whisperFft)
  const sin = new Float32Array(bins * whisperFft)
  for (let k = 0; k < bins; k++) {
    for (let n = 0; n < whisperFft; n++) {
      const angle = (2 * Math.PI * k * n) / whisperFft
      cos[k * whisperFft + n] = Math.cos(angle)
      sin[k * whisperFft + n] = Math.sin(angle)
    }
  }
  const reflect = (at: number): number => {
    const last = whisperSamples - 1
    const i = at < 0 ? -at : at > last ? 2 * last - at : at
    return padded[i] ?? 0
  }
  const frame = new Float32Array(whisperFft)
  const power = new Float32Array(bins)
  const logMel = new Float32Array(whisperBands * whisperFrames)
  let loudest = Number.NEGATIVE_INFINITY
  for (let f = 0; f < whisperFrames; f++) {
    const start = f * whisperHop - half
    // Past the speech the padding is silence, whose spectrum is zero.
    const silent = start > samples16k.length + half
    for (let n = 0; n < whisperFft; n++) {
      frame[n] = silent ? 0 : reflect(start + n) * (window[n] ?? 0)
    }
    for (let k = 0; k < bins; k++) {
      let re = 0
      let im = 0
      if (!silent) {
        for (let n = 0; n < whisperFft; n++) {
          const x = frame[n] ?? 0
          re += x * (cos[k * whisperFft + n] ?? 0)
          im -= x * (sin[k * whisperFft + n] ?? 0)
        }
      }
      power[k] = re * re + im * im
    }
    for (let band = 0; band < whisperBands; band++) {
      let sum = 0
      for (let k = 0; k < bins; k++) {
        sum += (whisperFilters[band * bins + k] ?? 0) * (power[k] ?? 0)
      }
      const value = Math.log10(Math.max(sum, 1e-10))
      logMel[band * whisperFrames + f] = value
      loudest = Math.max(loudest, value)
    }
  }
  for (let i = 0; i < logMel.length; i++) {
    logMel[i] = (Math.max(logMel[i] ?? 0, loudest - 8) + 4) / 4
  }
  return logMel
}

// A recording's frames by the model: frames x dims, at the model's
// `frameHz`, as many as cover the recording.
export type SoundFeatures = Readonly<{
  frameHz: number
  dims: number
  data: Float32Array
}>

export const normaliseSamples = (samples: Float32Array): Float32Array => {
  let sum = 0
  for (const sample of samples) sum += sample
  const mean = samples.length > 0 ? sum / samples.length : 0
  let squares = 0
  for (const sample of samples) squares += (sample - mean) ** 2
  const scale =
    1 / Math.sqrt((samples.length > 0 ? squares / samples.length : 0) + 1e-7)
  return samples.map(sample => (sample - mean) * scale)
}

// The model's one input for a recording, as its own feature extractor
// makes it.
export const soundModelInput = (
  model: SoundModel,
  samples16k: Float32Array,
): Readonly<{ name: string; data: Float32Array; dims: Array<number> }> =>
  model.input === 'whisper-mel'
    ? {
        name: 'input_features',
        data: whisperLogMel(samples16k),
        dims: [1, whisperBands, whisperFrames],
      }
    : {
        name: 'input_values',
        data: model.normalise ? normaliseSamples(samples16k) : samples16k,
        dims: [1, samples16k.length],
      }

// How many of the model's frames cover a recording of this many samples.
export const soundFramesOf = (model: SoundModel, samples: number): number =>
  Math.min(
    Math.floor((samples / 16_000) * model.frameHz),
    model.input === 'whisper-mel' ? 1500 : Number.POSITIVE_INFINITY,
  )

export const runSoundModel = async (
  model: SoundModel,
  session: ort.InferenceSession,
  samples16k: Float32Array,
): Promise<SoundFeatures> => {
  const frames = soundFramesOf(model, samples16k.length)
  const input = soundModelInput(model, samples16k)
  const feeds = {
    [input.name]: new ort.Tensor('float32', input.data, input.dims),
  }
  const result = await session.run(feeds)
  const output = result['last_hidden_state']
  if (output === undefined) {
    throw new Error(`${model.id} gave no last_hidden_state`)
  }
  const all = output.data
  if (!(all instanceof Float32Array)) {
    throw new Error(`${model.id} gave ${output.type}, not float32`)
  }
  const outputFrames = output.dims[1] ?? 0
  const kept = Math.min(frames, outputFrames)
  const data = all.slice(0, kept * model.dims)
  output.dispose()
  return { frameHz: model.frameHz, dims: model.dims, data }
}

export const openSoundSession = async (
  bytes: Uint8Array,
): Promise<ort.InferenceSession> => {
  ort.env.wasm.numThreads = 1
  ort.env.wasm.proxy = false
  return ort.InferenceSession.create(bytes, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  })
}
