// Lets a script under Node import the app's own source, whose relative
// imports name no extension (`./swift-f0`, as Vite resolves them): a
// relative specifier Node cannot find is tried again with `.ts`. Loaded
// before the script, with `node --import ./scripts/source-imports.ts`.

import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      const relative = specifier.startsWith('./') || specifier.startsWith('../')
      if (
        relative &&
        !specifier.endsWith('.ts') &&
        error instanceof Error &&
        'code' in error &&
        error.code === 'ERR_MODULE_NOT_FOUND'
      ) {
        return nextResolve(`${specifier}.ts`, context)
      }
      throw error
    }
  },
})
