// Refused: src/engine runs per audio block and per frame, so it imports
// nothing from Effect.
import { Effect } from 'effect' // lint: eslint(no-restricted-imports)
import type { Schema } from 'effect' // lint: eslint(no-restricted-imports)
import * as Stream from 'effect/Stream' // lint: eslint(no-restricted-imports)

import { BrowserRuntime } from '@effect/platform-browser' // lint: eslint(no-restricted-imports)

export const used = [Effect, Stream, BrowserRuntime]
export type Used = Schema.Top
