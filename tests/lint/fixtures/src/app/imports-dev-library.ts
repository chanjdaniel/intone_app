import { frame } from '/src/app/dev/entry' // lint: eslint(no-restricted-imports)

import * as dev from './dev' // lint: eslint(no-restricted-imports)
import { entry } from './dev/entries/tokens' // lint: eslint(no-restricted-imports)
// Refused: an import of the dev library, by any path.
import { open } from './dev/library' // lint: eslint(no-restricted-imports)
export { plannedEntries } from './dev/library' // lint: eslint(no-restricted-imports)
import { jsxDEV } from 'react/jsx-dev-runtime'

import { DevTools } from '@foldkit/devtools'

// Allowed: names that only start or end like it, and package paths.
import { devTools } from './devTools'
import { level } from './device/level'

// Refused: a dynamic import anywhere but src/app/devLibrary.ts.
export const load = () => import('./dev/library') // lint: eslint(no-restricted-imports)

export const used = [open, entry, dev, frame, devTools, level, DevTools, jsxDEV]
