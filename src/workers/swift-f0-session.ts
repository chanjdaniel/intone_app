import { Effect, Schema, type Scope } from 'effect'
import * as ort from 'onnxruntime-web/wasm'

import type { SwiftF0Inference } from '../engine/pitch/swift-f0'

// SwiftF0 in ONNX Runtime Web: one session, on one thread, held in a scope
// that releases it, and its WebAssembly memory with it, on close.

export class SwiftF0LoadError extends Schema.TaggedError<
  SwiftF0LoadError,
  { readonly brand: unique symbol }
>()('SwiftF0LoadError', { reason: Schema.String }) {}

export class SwiftF0RunError extends Schema.TaggedError<
  SwiftF0RunError,
  { readonly brand: unique symbol }
>()('SwiftF0RunError', { reason: Schema.String }) {}

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

// `wasmPaths` is where ONNX Runtime's WebAssembly is served from, the
// app's own origin (`onnxRuntimeWasmPaths`); without it, ONNX Runtime's
// own default, which in Node is the package's files.
export const openSwiftF0 = (
  model: Uint8Array,
  wasmPaths?: string,
): Effect.Effect<
  (
    ...args: Parameters<SwiftF0Inference>
  ) => Effect.Effect<Awaited<ReturnType<SwiftF0Inference>>, SwiftF0RunError>,
  SwiftF0LoadError,
  Scope.Scope
> =>
  Effect.gen(function* () {
    yield* Effect.sync(() => {
      // One thread: the app runs without cross-origin isolation, so there
      // is no SharedArrayBuffer for ONNX Runtime's thread pool.
      ort.env.wasm.numThreads = 1
      ort.env.wasm.proxy = false
      if (wasmPaths !== undefined) {
        ort.env.wasm.wasmPaths = wasmPaths
      }
    })
    const session = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () =>
          ort.InferenceSession.create(model, {
            executionProviders: ['wasm'],
            graphOptimizationLevel: 'all',
          }),
        catch: error => new SwiftF0LoadError({ reason: reasonOf(error) }),
      }),
      opened => Effect.promise(() => opened.release()),
    )
    return (samples: Float32Array, minHz: number, maxHz: number) =>
      Effect.tryPromise({
        try: async () => {
          const outputs = await session.run({
            audio: new ort.Tensor('float32', samples, [1, samples.length]),
            fmin: new ort.Tensor('float32', Float32Array.of(minHz), []),
            fmax: new ort.Tensor('float32', Float32Array.of(maxHz), []),
          })
          const pitch = outputs['pitch']
          const confidence = outputs['confidence']
          if (pitch === undefined || confidence === undefined) {
            throw new Error('SwiftF0 gave no pitch or confidence')
          }
          return {
            pitchHz: Float32Array.from(pitch.data, Number),
            confidence: Float32Array.from(confidence.data, Number),
          }
        },
        catch: error => new SwiftF0RunError({ reason: reasonOf(error) }),
      })
  })
