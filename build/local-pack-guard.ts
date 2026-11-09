import { createHash } from 'node:crypto'
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { type Plugin, normalizePath } from 'vite'

// Fails every production build that would ship anything from Daniel's
// local pack, the git-ignored `local/` folder (docs/local-pack.md): a
// module imported from it, an asset emitted from it, or any output file,
// the public folder's copies included, whose bytes are a file of it. The
// pack is imported in the browser from files Daniel chooses, so nothing
// of it ever belongs in the build.

export const localPackFolder = 'local'

const cleanId = (id: string): string =>
  id.replace(/^\0/, '').split('?')[0] ?? id

const sha256 = (bytes: Uint8Array | string): string =>
  createHash('sha256').update(bytes).digest('hex')

const filesUnder = (folder: string): ReadonlyArray<string> =>
  readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const path = join(folder, entry.name)
    return entry.isDirectory()
      ? filesUnder(path)
      : entry.isFile() || entry.isSymbolicLink()
        ? [path]
        : []
  })

// The local pack's files by their length, and each one's hash once asked
// for, so a large pack is read only where an output file is as long.
const packIndex = (folder: string) => {
  const bySize = new Map<number, Array<string>>()
  if (existsSync(folder)) {
    filesUnder(folder).forEach(path => {
      const size = statSync(path).size
      if (size > 0) {
        bySize.set(size, [...(bySize.get(size) ?? []), path])
      }
    })
  }
  const hashes = new Map<string, string>()
  const hashOf = (path: string): string => {
    const known = hashes.get(path)
    if (known !== undefined) {
      return known
    }
    const made = sha256(readFileSync(path))
    hashes.set(path, made)
    return made
  }
  // The local pack's file whose bytes `bytes` are, if one is.
  const copyOf = (bytes: Uint8Array | string): string | undefined => {
    const length =
      typeof bytes === 'string' ? Buffer.byteLength(bytes) : bytes.byteLength
    const candidates = bySize.get(length)
    if (candidates === undefined) {
      return undefined
    }
    const hash = sha256(bytes)
    return candidates.find(path => hashOf(path) === hash)
  }
  // Whether a file of `size` bytes could be one of the pack's.
  const hasSize = (size: number): boolean => bySize.has(size)
  return { copyOf, hasSize }
}

export const localPackGuard = (folder: string = localPackFolder): Plugin => {
  let guarded = ''
  let root = ''
  let outDir = ''
  let isProduction = false
  let writes = true
  const named = (path: string): string => normalizePath(relative(root, path))
  const inside = (id: string): boolean =>
    id === guarded || id.startsWith(`${guarded}/`)
  return {
    name: 'intone:local-pack-guard',
    apply: 'build',
    configResolved(config) {
      isProduction = config.isProduction
      root = normalizePath(realpathSync(config.root))
      const folderPath = resolve(config.root, folder)
      guarded = normalizePath(
        existsSync(folderPath) ? realpathSync(folderPath) : folderPath,
      )
      outDir = resolve(config.root, config.build.outDir)
      writes = config.build.write
    },
    generateBundle(_options, bundle) {
      if (!isProduction) {
        return
      }
      const { copyOf } = packIndex(guarded)
      const found = Object.values(bundle).flatMap(output => {
        const sources =
          output.type === 'chunk'
            ? output.moduleIds.map(cleanId)
            : output.originalFileNames.map(name => resolve(root, name))
        const fromPack = sources
          .map(normalizePath)
          .filter(inside)
          .map(id => `  ${output.fileName}: ${named(id)}`)
        const copy = copyOf(
          output.type === 'chunk' ? output.code : output.source,
        )
        return [
          ...fromPack,
          ...(copy === undefined
            ? []
            : [`  ${output.fileName}: the bytes of ${named(copy)}`]),
        ]
      })
      if (found.length > 0) {
        this.error(
          `Daniel's local pack (${folder}/) is in a production build:\n${found.join('\n')}`,
        )
      }
    },
    // The public folder is copied as it is, so its copies are read where
    // they were written.
    closeBundle() {
      if (!isProduction || !writes || !existsSync(outDir)) {
        return
      }
      const { copyOf, hasSize } = packIndex(guarded)
      const found = filesUnder(outDir).flatMap(path => {
        const copy = hasSize(statSync(path).size)
          ? copyOf(readFileSync(path))
          : undefined
        return copy === undefined
          ? []
          : [
              `  ${normalizePath(relative(outDir, path))}: the bytes of ${named(copy)}`,
            ]
      })
      if (found.length > 0) {
        this.error(
          `Daniel's local pack (${folder}/) is in a production build:\n${found.join('\n')}`,
        )
      }
    },
  }
}
