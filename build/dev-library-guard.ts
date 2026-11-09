import { realpathSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { type Plugin, normalizePath } from 'vite'

// Fails every production build that holds a module from the dev-only
// component library, naming each chunk and module. Lint refuses an import
// of the folder; this catches what lint cannot: a dynamic import, or a
// development-only branch the build kept alive.

export const devLibraryFolder = 'src/app/dev'

// Module ids are real paths with `/` separators (Vite resolves links), so
// the folder is compared the same way, or the guard would fail open on a
// linked checkout or on Windows.
const cleanId = (id: string): string =>
  id.replace(/^\0/, '').split('?')[0] ?? id

export const devLibraryGuard = (folder: string = devLibraryFolder): Plugin => {
  let guarded = ''
  let root = ''
  let isProduction = false
  return {
    name: 'intone:dev-library-guard',
    apply: 'build',
    configResolved(config) {
      isProduction = config.isProduction
      root = normalizePath(realpathSync(config.root))
      guarded = normalizePath(realpathSync(resolve(config.root, folder)))
    },
    generateBundle(_options, bundle) {
      if (!isProduction) {
        return
      }
      const found = Object.values(bundle).flatMap(output =>
        output.type === 'chunk'
          ? output.moduleIds
              .map(cleanId)
              .filter(id => id === guarded || id.startsWith(`${guarded}/`))
              .map(
                id =>
                  `  chunk ${output.fileName}: ${normalizePath(relative(root, id))}`,
              )
          : [],
      )
      if (found.length > 0) {
        this.error(
          `The dev-only component library (${folder}) is in a production build:\n${found.join('\n')}`,
        )
      }
    },
  }
}
