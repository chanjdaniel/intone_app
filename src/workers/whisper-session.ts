import { Effect, Predicate, Schema, type Scope } from 'effect'

import {
  type AutomaticSpeechRecognitionPipeline,
  Tensor,
  env,
  pipeline,
} from '@huggingface/transformers'

import { reasonOf } from '../engine/reason'
import type { TextPiece } from '../engine/text/pieces'
import { piecesOf } from '../engine/text/pieces'
import type { Span } from '../engine/text/windows'
import { textModelCacheName } from './text-model-cache'
import type { Device, TextModel } from './text-protocol'
import { textSampleRate } from './text-protocol'

// Whisper through Transformers.js 4.3.2, held in a scope that disposes
// its sessions, and their memory, on close. Remote models are off and
// local models on, below the app's own `/models/`, each loaded by
// `<id>/<version>`, with Transformers.js's browser cache kept on
// (./text-model-cache.ts fills it first). On a GPU that WebGPU reaches
// the encoder runs there and the decoder on the CPU: the int8 decoder
// runs slower under WebGPU than on the CPU, and the q4 encoder over three
// times faster, from the same files (docs/transcription.md); with no GPU,
// or a software one, both run on the CPU.

export class WhisperError extends Schema.TaggedError<
  WhisperError,
  { readonly brand: unique symbol }
>()('WhisperError', { reason: Schema.String }) {}

export type Whisper = Readonly<{
  device: Device
  // The pieces of text in one window of the clip, seconds from the
  // clip's start.
  read: (
    samples: Float32Array,
    window: Span,
  ) => Effect.Effect<ReadonlyArray<TextPiece>, WhisperError>
}>

// The quantisations T226's spike ran and docs/transcription.md measured;
// models.json lists exactly these files.
const dtype = { encoder_model: 'q4', decoder_model_merged: 'int8' } as const

export const configureTransformers = (
  modelsRoot: string,
  wasmPaths: Readonly<{ wasm: string; mjs: string }>,
): void => {
  env.allowRemoteModels = false
  env.allowLocalModels = true
  env.localModelPath = modelsRoot
  env.useBrowserCache = true
  env.cacheKey = textModelCacheName
  // NOTE: on, Transformers.js would load ONNX Runtime's loader from a
  // `blob:` URL, which the Content Security Policy refuses; off, ONNX
  // Runtime fetches both files from `wasmPaths`, kept by the HTTP cache.
  env.useWasmCache = false
  const onnx = env.backends.onnx
  if (onnx.wasm !== undefined) {
    onnx.wasm.wasmPaths = { wasm: wasmPaths.wasm, mjs: wasmPaths.mjs }
    onnx.wasm.numThreads = 1
    onnx.wasm.proxy = false
  }
}

// A GPU WebGPU reaches, not a software one.
const hasGpu = async (): Promise<boolean> => {
  if (!('gpu' in navigator) || navigator.gpu === undefined) {
    return false
  }
  const adapter = await navigator.gpu
    .requestAdapter({ powerPreference: 'high-performance' })
    .catch(() => null)
  return adapter !== null && adapter.info.isFallbackAdapter !== true
}

const created = (model: TextModel, device: Device) =>
  pipeline('automatic-speech-recognition', model.name, {
    device:
      device === 'WebGpu'
        ? { encoder_model: 'webgpu', decoder_model_merged: 'wasm' }
        : 'wasm',
    dtype,
  })

const opened = async (
  model: TextModel,
): Promise<{ asr: AutomaticSpeechRecognitionPipeline; device: Device }> => {
  if (await hasGpu()) {
    const onGpu = await created(model, 'WebGpu').catch(() => null)
    if (onGpu !== null) {
      return { asr: onGpu, device: 'WebGpu' }
    }
  }
  return { asr: await created(model, 'Wasm'), device: 'Wasm' }
}

export const openWhisper = (
  model: TextModel,
): Effect.Effect<Whisper, WhisperError, Scope.Scope> =>
  Effect.gen(function* () {
    const { asr, device } = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () => opened(model),
        catch: error =>
          new WhisperError({
            reason: `The text model could not be opened: ${reasonOf(error)}`,
          }),
      }),
      ({ asr }) => Effect.promise(() => asr.dispose()).pipe(Effect.ignore),
    )
    const tokenizer = asr.tokenizer
    const special = new Set(tokenizer.all_special_ids)
    // The Whisper tokenizer's own getter, which its base type does not
    // name.
    const timestampBegin =
      'timestamp_begin' in tokenizer &&
      Predicate.isNumber(tokenizer.timestamp_begin)
        ? tokenizer.timestamp_begin
        : null
    if (timestampBegin === null) {
      return yield* new WhisperError({
        reason: 'The text model’s tokenizer has no timestamps.',
      })
    }
    const vocabulary = {
      timestampBegin,
      secondsPerTimestamp: 0.02,
      isSpecial: (id: number) => special.has(id),
      decode: (ids: ReadonlyArray<number>) => tokenizer.decode([...ids]),
    }
    const config: unknown = asr.processor.feature_extractor?.config
    // Whisper's 10 ms hop, as its preprocessor_config.json gives it.
    const hopLength =
      Predicate.hasProperty(config, 'hop_length') &&
      Predicate.isNumber(config.hop_length)
        ? config.hop_length
        : 160

    const read = (samples: Float32Array, window: Span) =>
      Effect.tryPromise({
        try: async () => {
          const slice = samples.subarray(
            Math.round(window.from * textSampleRate),
            Math.round(window.to * textSampleRate),
          )
          const features: unknown = await asr.processor(slice)
          if (
            !Predicate.hasProperty(features, 'input_features') ||
            !(features.input_features instanceof Tensor)
          ) {
            throw new Error('the audio gave no features')
          }
          const output: unknown = await asr.model.generate({
            inputs: features.input_features,
            language: 'japanese',
            task: 'transcribe',
            return_timestamps: true,
            return_token_timestamps: true,
            num_frames: Math.floor(slice.length / hopLength),
          })
          if (
            !Predicate.hasProperty(output, 'sequences') ||
            !(output.sequences instanceof Tensor) ||
            !Predicate.hasProperty(output, 'token_timestamps') ||
            !(output.token_timestamps instanceof Tensor)
          ) {
            throw new Error('it gave no token times')
          }
          const [tokens = []] = output.sequences.tolist()
          const [times = []] = output.token_timestamps.tolist()
          return piecesOf(
            [...tokens].map(Number),
            [...times].map(Number),
            vocabulary,
            window.from,
          )
        },
        catch: error =>
          new WhisperError({
            reason: `The text model stopped: ${reasonOf(error)}`,
          }),
      })

    return { device, read }
  })
