import { Schema } from 'effect'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { copyFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Plugin } from 'vite'

import { modelRequestHandler } from './model-requests.ts'

// The checked model list, `models.json`: every model the app serves, each
// one or more files fetched at a pinned revision, checked by size and
// SHA-256, cached in `.cache/models/`, and served from the app's own
// origin in the model's directory, `/models/<id>/<version>/`, whose
// version changes when any of its files does.
//
//   node build/models.ts    fetches and checks every listed file into the cache

const sha256Pattern = /^[0-9a-f]{64}$/
const segment = String.raw`[\w-]+(\.[\w-]+)*`

export const ModelFile = Schema.Struct({
  // Relative to the model's directory; may name a folder, as
  // Transformers.js's layout does (`onnx/decoder_model_merged_int8.onnx`).
  path: Schema.String.check(
    Schema.isPattern(new RegExp(`^${segment}(/${segment})*$`)),
  ),
  // A pinned revision: the URL names a 40-character commit, never a branch.
  url: Schema.String.check(
    Schema.isPattern(/^https:\/\/[^\s]*\/[0-9a-f]{40}\/[^\s]+$/),
  ),
  bytes: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  sha256: Schema.String.check(Schema.isPattern(sha256Pattern)),
})
export type ModelFile = typeof ModelFile.Type

export const Model = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^[a-z0-9]+(-[a-z0-9]+)*$/)),
  name: Schema.String.check(Schema.isMinLength(1)),
  licence: Schema.String.check(Schema.isMinLength(1)),
  source: Schema.String.check(Schema.isPattern(/^https:\/\//)),
  files: Schema.NonEmptyArray(ModelFile).check(
    Schema.makeFilter(
      files =>
        new Set(files.map(file => file.path)).size === files.length ||
        'every file path of a model is used once',
    ),
  ),
})
export type Model = typeof Model.Type

export const ModelList = Schema.Struct({
  models: Schema.Array(Model).check(
    Schema.makeFilter(
      models =>
        new Set(models.map(model => model.id)).size === models.length ||
        'every model id is used once',
    ),
  ),
})
export type ModelList = typeof ModelList.Type

export const readModelList = async (
  path: string,
): Promise<ReadonlyArray<Model>> =>
  Schema.decodeSync(Schema.fromJsonString(ModelList))(
    await readFile(path, 'utf8'),
  ).models

// The first 16 hex digits of the SHA-256 of the model's sorted
// `<path> <sha256>` lines, each ended by a newline: any changed, added or
// removed file moves the whole model to a new directory.
export const modelVersion = (model: Model): string =>
  createHash('sha256')
    .update(
      model.files
        .map(file => `${file.path} ${file.sha256}\n`)
        .sort()
        .join(''),
    )
    .digest('hex')
    .slice(0, 16)

// The model's directory below the site's base, ending in `/`.
export const modelDirectory = (model: Model): string =>
  `models/${model.id}/${modelVersion(model)}/`

// A file's output path below the site's base.
export const modelFilePath = (model: Model, file: ModelFile): string =>
  modelDirectory(model) + file.path

// Every file of every model, with its output path below the site's base.
export const servedModelFiles = (
  models: ReadonlyArray<Model>,
): ReadonlyArray<Readonly<{ model: Model; file: ModelFile; path: string }>> =>
  models.flatMap(model =>
    model.files.map(file => ({
      model,
      file,
      path: modelFilePath(model, file),
    })),
  )

export const isSingleFile = (model: Model): boolean => model.files.length === 1

export const modelDirectories = (
  models: ReadonlyArray<Model>,
  base: string,
): Record<string, string> =>
  Object.fromEntries(
    models.map(model => [model.id, base + modelDirectory(model)]),
  )

// The URL of each model of one file, which is how the tracker, the clip
// Worker and native curves load SwiftF0 and Silero VAD.
export const modelUrls = (
  models: ReadonlyArray<Model>,
  base: string,
): Record<string, string> =>
  Object.fromEntries(
    models
      .filter(isSingleFile)
      .map(model => [model.id, base + modelFilePath(model, model.files[0])]),
  )

export class ModelFileError extends Error {
  override name = 'ModelFileError'
}

const named = (modelId: string, file: ModelFile): string =>
  `${modelId} (${file.path})`

const isFile = async (path: string): Promise<boolean> =>
  stat(path).then(
    found => found.isFile(),
    () => false,
  )

const hashOf = async (path: string): Promise<string> => {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

const download = async (
  modelId: string,
  file: ModelFile,
  destination: string,
): Promise<{ bytes: number; sha256: string }> => {
  const response = await fetch(file.url).catch((cause: unknown) => {
    throw new ModelFileError(
      `Model ${named(modelId, file)}: could not fetch ${file.url}: ${String(cause)}`,
    )
  })
  if (!response.ok || response.body === null) {
    throw new ModelFileError(
      `Model ${named(modelId, file)}: ${file.url} answered ${response.status} ${response.statusText}`,
    )
  }
  const hash = createHash('sha256')
  let bytes = 0
  await pipeline(
    Readable.from(response.body),
    new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk)
        bytes += chunk.length
        callback(null, chunk)
      },
    }),
    createWriteStream(destination),
  )
  return { bytes, sha256: hash.digest('hex') }
}

// Returns the path of a model's file in the cache, downloading it first
// unless a cached copy already has the listed hash. Throws, naming the
// file, when a download's size or hash differs from the list; a file that
// fails the check is never left in the cache. The cache is
// content-addressed, `<cache>/<sha256>/<file name>`, so a file is fetched
// once whichever model directory serves it.
export const ensureCached = async (
  modelId: string,
  file: ModelFile,
  cacheDirectory: string,
): Promise<string> => {
  const cached = join(cacheDirectory, file.sha256, basename(file.path))
  if ((await isFile(cached)) && (await hashOf(cached)) === file.sha256) {
    return cached
  }
  await mkdir(dirname(cached), { recursive: true })
  const partial = `${cached}.${randomUUID()}.part`
  try {
    const got = await download(modelId, file, partial)
    if (got.bytes !== file.bytes) {
      throw new ModelFileError(
        `Model ${named(modelId, file)}: size mismatch, models.json says ${file.bytes} bytes, ${file.url} gave ${got.bytes}`,
      )
    }
    if (got.sha256 !== file.sha256) {
      throw new ModelFileError(
        `Model ${named(modelId, file)}: SHA-256 mismatch, models.json says ${file.sha256}, ${file.url} gave ${got.sha256}`,
      )
    }
    await rename(partial, cached)
    return cached
  } finally {
    await rm(partial, { force: true })
  }
}

// Every file of every model, cached and checked, one after another.
export const ensureAllCached = async (
  models: ReadonlyArray<Model>,
  cacheDirectory: string,
): Promise<void> => {
  for (const { model, file } of servedModelFiles(models)) {
    await ensureCached(model.id, file, cacheDirectory)
  }
}

// THE VITE PLUGIN

export const modelsModuleId = 'virtual:intone/models'
const resolvedModelsModuleId = `\0${modelsModuleId}`

export type ModelsOptions = Readonly<{
  // Both relative to the project root.
  list?: string
  cache?: string
}>

// A build fetches and checks every listed file before bundling, fails on
// the first mismatch, and copies the files into the output once it is
// written, so no model's bytes pass through the bundler. The app reads
// each model's same-origin directory, and a one-file model's URL, from
// `virtual:intone/models`. Both servers answer the same paths through
// `modelRequestHandler`: the dev server from the cache, fetching a file on
// first request, and `vite preview` from the build output.
export const models = (options: ModelsOptions = {}): Plugin => {
  let root = process.cwd()
  let base = '/'
  let outDir = 'dist'
  let command: 'build' | 'serve' = 'serve'
  const listPath = (): string => resolve(root, options.list ?? 'models.json')
  const cachePath = (): string =>
    resolve(root, options.cache ?? join('.cache', 'models'))
  let listed: ReadonlyArray<Model> = []

  const listedFile = async (path: string) =>
    servedModelFiles(await readModelList(listPath())).find(
      each => each.path === path,
    )

  // The dev server checks each cached file once, not on every request.
  const checked = new Map<string, Promise<string>>()
  const cachedOnce = (model: Model, file: ModelFile): Promise<string> => {
    const found = checked.get(file.sha256)
    if (found !== undefined) {
      return found
    }
    const pending = ensureCached(model.id, file, cachePath())
    pending.catch(() => checked.delete(file.sha256))
    checked.set(file.sha256, pending)
    return pending
  }

  return {
    name: 'intone:models',
    configResolved(config) {
      root = config.root
      base = config.base
      outDir = config.build.outDir
      command = config.command
    },
    async buildStart() {
      this.addWatchFile(listPath())
      listed = await readModelList(listPath())
      if (command === 'build') {
        await ensureAllCached(listed, cachePath()).catch((error: unknown) =>
          this.error(error instanceof Error ? error.message : String(error)),
        )
      }
    },
    resolveId(id) {
      return id === modelsModuleId ? resolvedModelsModuleId : undefined
    },
    async load(id) {
      if (id !== resolvedModelsModuleId) {
        return undefined
      }
      listed = await readModelList(listPath())
      return [
        `export const modelDirectories = Object.freeze(${JSON.stringify(modelDirectories(listed, base))})`,
        `export const modelUrls = Object.freeze(${JSON.stringify(modelUrls(listed, base))})`,
        '',
      ].join('\n')
    },
    async writeBundle(output) {
      const directory = output.dir ?? resolve(root, outDir)
      for (const { model, file, path } of servedModelFiles(listed)) {
        const target = join(directory, path)
        await mkdir(dirname(target), { recursive: true })
        await copyFile(await ensureCached(model.id, file, cachePath()), target)
      }
    },
    configureServer(server) {
      server.middlewares.use(
        modelRequestHandler({
          base,
          locate: async path => {
            const served = await listedFile(path)
            return served && cachedOnce(served.model, served.file)
          },
        }),
      )
    },
    configurePreviewServer(server) {
      const built = resolve(root, outDir)
      server.middlewares.use(
        modelRequestHandler({
          base,
          locate: async path =>
            (await listedFile(path)) === undefined
              ? undefined
              : join(built, path),
        }),
      )
    },
  }
}

const isMain = process.argv[1] === import.meta.filename

if (isMain) {
  const root = process.cwd()
  const listed = await readModelList(join(root, 'models.json'))
  await ensureAllCached(listed, join(root, '.cache', 'models'))
  console.log(
    `Cached and checked ${servedModelFiles(listed).length} files of ${listed.length} models in .cache/models/.`,
  )
}
