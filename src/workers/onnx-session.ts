import { Effect, Schema, type Scope } from 'effect'
import * as ort from 'onnxruntime-web/wasm'

import { reasonOf } from '../engine/reason'

// One ONNX Runtime Web session, on one thread, held in a scope that
// releases it, and its WebAssembly memory with it, on close. The tracker
// and the clip Worker open their models through it.

export class ModelLoadError extends Schema.TaggedError<
  ModelLoadError,
  { readonly brand: unique symbol }
>()('ModelLoadError', { reason: Schema.String }) {}

export class ModelRunError extends Schema.TaggedError<
  ModelRunError,
  { readonly brand: unique symbol }
>()('ModelRunError', { reason: Schema.String }) {}

// `wasmPaths` is where ONNX Runtime's WebAssembly is served from, the
// app's own origin (`onnxRuntimeWasmPaths`); without it, ONNX Runtime's
// own default, which in Node is the package's files.
export const openSession = (
  model: Uint8Array,
  wasmPaths?: string,
): Effect.Effect<ort.InferenceSession, ModelLoadError, Scope.Scope> =>
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
    return yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () =>
          ort.InferenceSession.create(model, {
            executionProviders: ['wasm'],
            graphOptimizationLevel: 'all',
          }),
        catch: error => new ModelLoadError({ reason: reasonOf(error) }),
      }),
      opened => Effect.promise(() => opened.release()),
    )
  })

// A model file, fetched from the app's own origin; `what` names it in the
// reason it did not load.
export const fetchModel = (
  url: string,
  what: string,
): Effect.Effect<Uint8Array, ModelLoadError> =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`the server answered ${response.status}`)
      }
      return new Uint8Array(await response.arrayBuffer())
    },
    catch: error =>
      new ModelLoadError({
        reason: `The ${what} did not load: ${reasonOf(error)}`,
      }),
  })
