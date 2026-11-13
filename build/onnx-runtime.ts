import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

import { answering, send } from './model-requests.ts'

// ONNX Runtime Web's WebAssembly build, served from the app's own origin.
// The app runs it on one thread with no cross-origin isolation, so only
// the plain CPU build ships: its `.wasm` and the `.mjs` that loads it. The
// app points ONNX Runtime's `wasmPaths` at `onnxRuntimeWasmPaths` from
// `virtual:intone/onnx-runtime`.

export const onnxRuntimeFiles = [
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.mjs',
] as const

const distDirectory = (): string =>
  dirname(
    fileURLToPath(
      import.meta.resolve(`onnxruntime-web/${onnxRuntimeFiles[0]}`),
    ),
  )

export const onnxRuntimeVersion = async (): Promise<string> => {
  const manifest: unknown = JSON.parse(
    await readFile(join(distDirectory(), '..', 'package.json'), 'utf8'),
  )
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    !('version' in manifest) ||
    typeof manifest.version !== 'string'
  ) {
    throw new Error('onnxruntime-web/package.json has no version')
  }
  return manifest.version
}

// Below the site's base; the version names the directory, so a new release
// is a new path and each file can be cached for good.
export const onnxRuntimeDirectory = (version: string): string =>
  `ort/${version}/`

export const onnxRuntimeModuleId = 'virtual:intone/onnx-runtime'
const resolvedModuleId = `\0${onnxRuntimeModuleId}`

export const onnxRuntime = (): Plugin => {
  let root = process.cwd()
  let base = '/'
  let directory = ''
  return {
    name: 'intone:onnx-runtime',
    async configResolved(config) {
      root = config.root
      base = config.base
      directory = onnxRuntimeDirectory(await onnxRuntimeVersion())
    },
    resolveId(id) {
      return id === onnxRuntimeModuleId ? resolvedModuleId : undefined
    },
    load(id) {
      if (id !== resolvedModuleId) {
        return undefined
      }
      return `export const onnxRuntimeWasmPaths = ${JSON.stringify(base + directory)}\n`
    },
    async writeBundle(output) {
      const target = join(output.dir ?? resolve(root, 'dist'), directory)
      await mkdir(target, { recursive: true })
      for (const file of onnxRuntimeFiles) {
        await copyFile(join(distDirectory(), file), join(target, file))
      }
    },
    // In development, from the package itself, as model files are sent
    // (./model-requests.ts): the type, the length, a byte range.
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = (request.url ?? '').split('?')[0] ?? ''
        const file = onnxRuntimeFiles.find(
          each => path === base + directory + each,
        )
        if (file === undefined) {
          next()
          return
        }
        answering(response, next, () =>
          send(request, response, join(distDirectory(), file)),
        )
      })
    },
  }
}
