import { Effect, type Scope } from 'effect'
import * as ort from 'onnxruntime-web/wasm'

import {
  type SileroInference,
  sileroContext,
  sileroSampleRate,
  sileroStateSize,
  sileroWindow,
} from '../engine/cut/silero'
import { reasonOf } from '../engine/reason'
import { type ModelLoadError, ModelRunError, openSession } from './onnx-session'

// Silero VAD in ONNX Runtime Web, its session held in a scope that
// releases it on close (./onnx-session.ts): `input` (the window with its
// context), `state` and `sr` in, `output` and `stateN` out.

export const openSilero = (
  model: Uint8Array,
  wasmPaths?: string,
): Effect.Effect<
  (
    ...args: Parameters<SileroInference>
  ) => Effect.Effect<Awaited<ReturnType<SileroInference>>, ModelRunError>,
  ModelLoadError,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const session = yield* openSession(model, wasmPaths)
    const rate = new ort.Tensor(
      'int64',
      BigInt64Array.of(BigInt(sileroSampleRate)),
      [],
    )
    return (input: Float32Array, state: Float32Array) =>
      Effect.tryPromise({
        try: async () => {
          const outputs = await session.run({
            input: new ort.Tensor('float32', input, [
              1,
              sileroContext + sileroWindow,
            ]),
            state: new ort.Tensor('float32', state, [2, 1, 128]),
            sr: rate,
          })
          const output = outputs['output']
          const next = outputs['stateN']
          if (
            output === undefined ||
            next === undefined ||
            next.data.length !== sileroStateSize
          ) {
            throw new Error('Silero VAD gave no probability or state')
          }
          return {
            probability: Number(output.data[0] ?? 0),
            state: Float32Array.from(next.data, Number),
          }
        },
        catch: error => new ModelRunError({ reason: reasonOf(error) }),
      })
  })
