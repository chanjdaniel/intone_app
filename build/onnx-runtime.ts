import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

import { answering, send } from './model-requests.ts'

// ONNX Runtime Web's WebAssembly, served from the app's own origin, in two
// builds. The app's own models (SwiftF0, Silero VAD) run on one thread
// with no cross-origin isolation, so for them only the plain CPU build
// ships: its `.wasm` and the `.mjs` that loads it, at `onnxRuntimeWasmPaths`.
// Transformers.js 4.3.2 pins its own ONNX Runtime, a 1.31.0 development
// build installed beside it, and loads its `asyncify` build, which runs
// WebGPU as well as the CPU; the text Worker points `wasmPaths` at those
// two files, `textRuntimeWasmPaths`. Both come from
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

export const textRuntimeFiles = [
  'ort-wasm-simd-threaded.asyncify.wasm',
  'ort-wasm-simd-threaded.asyncify.mjs',
] as const

// Transformers.js's own copy, resolved from its package as Vite resolves
// its `onnxruntime-web/webgpu` import.
const textDistDirectory = (): string =>
  dirname(
    createRequire(
      fileURLToPath(import.meta.resolve('@huggingface/transformers')),
    ).resolve('onnxruntime-web'),
  )

const versionIn = async (dist: string): Promise<string> => {
  const manifest: unknown = JSON.parse(
    await readFile(join(dist, '..', 'package.json'), 'utf8'),
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

export const onnxRuntimeVersion = (): Promise<string> =>
  versionIn(distDirectory())

export const textRuntimeVersion = (): Promise<string> =>
  versionIn(textDistDirectory())

const runtimes = async (): Promise<
  ReadonlyArray<
    Readonly<{ directory: string; dist: string; files: ReadonlyArray<string> }>
  >
> => [
  {
    directory: onnxRuntimeDirectory(await onnxRuntimeVersion()),
    dist: distDirectory(),
    files: onnxRuntimeFiles,
  },
  {
    directory: onnxRuntimeDirectory(await textRuntimeVersion()),
    dist: textDistDirectory(),
    files: textRuntimeFiles,
  },
]

// Below the site's base; the version names the directory, so a new release
// is a new path and each file can be cached for good.
export const onnxRuntimeDirectory = (version: string): string =>
  `ort/${version}/`

export const onnxRuntimeModuleId = 'virtual:intone/onnx-runtime'
const resolvedModuleId = `\0${onnxRuntimeModuleId}`

export const onnxRuntime = (): Plugin => {
  let root = process.cwd()
  let base = '/'
  let served: Awaited<ReturnType<typeof runtimes>> = []
  return {
    name: 'intone:onnx-runtime',
    async configResolved(config) {
      root = config.root
      base = config.base
      served = await runtimes()
    },
    resolveId(id) {
      return id === onnxRuntimeModuleId ? resolvedModuleId : undefined
    },
    load(id) {
      if (id !== resolvedModuleId) {
        return undefined
      }
      const [app, text] = served
      if (app === undefined || text === undefined) {
        return undefined
      }
      const textPaths = {
        wasm: base + text.directory + textRuntimeFiles[0],
        mjs: base + text.directory + textRuntimeFiles[1],
      }
      return [
        `export const onnxRuntimeWasmPaths = ${JSON.stringify(base + app.directory)}`,
        `export const textRuntimeWasmPaths = Object.freeze(${JSON.stringify(textPaths)})`,
        '',
      ].join('\n')
    },
    async writeBundle(output) {
      for (const runtime of served) {
        const target = join(
          output.dir ?? resolve(root, 'dist'),
          runtime.directory,
        )
        await mkdir(target, { recursive: true })
        for (const file of runtime.files) {
          await copyFile(join(runtime.dist, file), join(target, file))
        }
      }
    },
    // In development, from the packages themselves, as model files are
    // sent (./model-requests.ts): the type, the length, a byte range.
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = (request.url ?? '').split('?')[0] ?? ''
        const found = served
          .flatMap(runtime => runtime.files.map(file => ({ runtime, file })))
          .find(({ runtime, file }) => path === base + runtime.directory + file)
        if (found === undefined) {
          next()
          return
        }
        answering(response, next, () =>
          send(request, response, join(found.runtime.dist, found.file)),
        )
      })
    },
  }
}
