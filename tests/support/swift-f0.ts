import { Effect } from 'effect'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { ensureCached, readModelList } from '../../build/models.ts'
import type { SwiftF0Inference } from '../../src/engine/pitch/swift-f0.ts'
import { openSwiftF0 } from '../../src/workers/swift-f0-session.ts'
import { root } from './run.ts'

// The real SwiftF0 model in ONNX Runtime Web's WebAssembly, under Node,
// for the tests in tests/tracker: the model file the build lists, fetched
// into .cache/models/ once.

export const loadSwiftF0Model = async (): Promise<Uint8Array<ArrayBuffer>> => {
  const list = await readModelList(join(root, 'models.json'))
  const swiftF0 = list.find(entry => entry.id === 'swift-f0')
  if (swiftF0 === undefined || swiftF0.files.length !== 1) {
    throw new Error('models.json lists no swift-f0 of one file')
  }
  return readFileSync(
    await ensureCached(
      swiftF0.id,
      swiftF0.files[0],
      join(root, '.cache', 'models'),
    ),
  )
}

// Runs `use` with a SwiftF0 session that is released after it.
export const withSwiftF0 = <A>(
  model: Uint8Array,
  use: (infer: SwiftF0Inference) => Promise<A>,
): Promise<A> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const run = yield* openSwiftF0(model)
        const runPromise = Effect.runPromiseWith(yield* Effect.context())
        return yield* Effect.promise(() =>
          use((samples, minHz, maxHz) =>
            runPromise(run(samples, minHz, maxHz)),
          ),
        )
      }),
    ),
  )
