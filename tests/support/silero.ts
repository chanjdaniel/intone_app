import { Effect } from 'effect'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { ensureCached, readModelList } from '../../build/models.ts'
import type { SileroInference } from '../../src/engine/cut/silero.ts'
import { openSilero } from '../../src/workers/silero-session.ts'
import { root } from './run.ts'

// The real Silero VAD model in ONNX Runtime Web's WebAssembly, under
// Node, for the tests in tests/tracker and the cut study: the model file
// the build lists, fetched into .cache/models/ once.

export const loadSileroModel = async (): Promise<Uint8Array<ArrayBuffer>> => {
  const list = await readModelList(join(root, 'models.json'))
  const silero = list.find(entry => entry.id === 'silero-vad')
  if (silero === undefined) {
    throw new Error('models.json lists no silero-vad')
  }
  return readFileSync(
    await ensureCached(silero, join(root, '.cache', 'models')),
  )
}

// Runs `use` with a Silero VAD session that is released after it.
export const withSilero = <A>(
  model: Uint8Array,
  use: (infer: SileroInference) => Promise<A>,
): Promise<A> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const run = yield* openSilero(model)
        const runPromise = Effect.runPromiseWith(yield* Effect.context())
        return yield* Effect.promise(() =>
          use((input, state) => runPromise(run(input, state))),
        )
      }),
    ),
  )
