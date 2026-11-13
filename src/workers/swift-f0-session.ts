import { Effect, type Scope } from 'effect'
import * as ort from 'onnxruntime-web/wasm'

import type { SwiftF0Inference } from '../engine/pitch/swift-f0'
import { reasonOf } from '../engine/reason'
import { type ModelLoadError, ModelRunError, openSession } from './onnx-session'

// SwiftF0 in ONNX Runtime Web, its session held in a scope that releases
// it on close (./onnx-session.ts).

export const openSwiftF0 = (
  model: Uint8Array,
  wasmPaths?: string,
): Effect.Effect<
  (
    ...args: Parameters<SwiftF0Inference>
  ) => Effect.Effect<Awaited<ReturnType<SwiftF0Inference>>, ModelRunError>,
  ModelLoadError,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const session = yield* openSession(model, wasmPaths)
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
        catch: error => new ModelRunError({ reason: reasonOf(error) }),
      })
  })
