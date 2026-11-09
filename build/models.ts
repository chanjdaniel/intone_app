import { Schema } from 'effect'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { copyFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Plugin } from 'vite'

// The checked model list, `models.json`: every model file the app serves,
// fetched at a pinned revision, checked by size and SHA-256, cached in
// `.cache/models/`, and served from the app's own origin under a path that
// changes with the file's hash.

const sha256Pattern = /^[0-9a-f]{64}$/

export const ModelFile = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^[a-z0-9]+(-[a-z0-9]+)*$/)),
  name: Schema.String.check(Schema.isMinLength(1)),
  file: Schema.String.check(Schema.isPattern(/^[\w-]+(\.[\w-]+)*$/)),
  // A pinned revision: the URL names a 40-character commit, never a branch.
  url: Schema.String.check(
    Schema.isPattern(/^https:\/\/[^\s]*\/[0-9a-f]{40}\/[^\s]+$/),
  ),
  bytes: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  sha256: Schema.String.check(Schema.isPattern(sha256Pattern)),
  licence: Schema.String.check(Schema.isMinLength(1)),
  source: Schema.String.check(Schema.isPattern(/^https:\/\//)),
})
export type ModelFile = typeof ModelFile.Type

export const ModelList = Schema.Struct({
  models: Schema.Array(ModelFile).check(
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
): Promise<ReadonlyArray<ModelFile>> =>
  Schema.decodeSync(Schema.fromJsonString(ModelList))(
    await readFile(path, 'utf8'),
  ).models

// The output path of a model file, below the site's base.
export const modelPath = (model: ModelFile): string =>
  `models/${model.id}/${model.sha256.slice(0, 16)}/${model.file}`

export const modelUrls = (
  models: ReadonlyArray<ModelFile>,
  base: string,
): Record<string, string> =>
  Object.fromEntries(models.map(model => [model.id, base + modelPath(model)]))

export class ModelFileError extends Error {
  override name = 'ModelFileError'
}

const named = (model: ModelFile): string => `${model.id} (${model.file})`

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
  model: ModelFile,
  destination: string,
): Promise<{ bytes: number; sha256: string }> => {
  const response = await fetch(model.url).catch((cause: unknown) => {
    throw new ModelFileError(
      `Model ${named(model)}: could not fetch ${model.url}: ${String(cause)}`,
    )
  })
  if (!response.ok || response.body === null) {
    throw new ModelFileError(
      `Model ${named(model)}: ${model.url} answered ${response.status} ${response.statusText}`,
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

// Returns the path of the model's file in the cache, downloading it first
// unless a cached copy already has the listed hash. Throws, naming the
// file, when a download's size or hash differs from the list; a file that
// fails the check is never left in the cache.
export const ensureCached = async (
  model: ModelFile,
  cacheDirectory: string,
): Promise<string> => {
  const cached = join(cacheDirectory, model.sha256, model.file)
  if ((await isFile(cached)) && (await hashOf(cached)) === model.sha256) {
    return cached
  }
  await mkdir(dirname(cached), { recursive: true })
  const partial = `${cached}.${randomUUID()}.part`
  try {
    const got = await download(model, partial)
    if (got.bytes !== model.bytes) {
      throw new ModelFileError(
        `Model ${named(model)}: size mismatch, models.json says ${model.bytes} bytes, ${model.url} gave ${got.bytes}`,
      )
    }
    if (got.sha256 !== model.sha256) {
      throw new ModelFileError(
        `Model ${named(model)}: SHA-256 mismatch, models.json says ${model.sha256}, ${model.url} gave ${got.sha256}`,
      )
    }
    await rename(partial, cached)
    return cached
  } finally {
    await rm(partial, { force: true })
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
// written, so no model's bytes pass through the bundler. The app reads each
// file's same-origin URL from `virtual:intone/models`. The dev server
// serves the same paths from the cache, fetching a file on first request.
export const models = (options: ModelsOptions = {}): Plugin => {
  let root = process.cwd()
  let base = '/'
  let command: 'build' | 'serve' = 'serve'
  const listPath = (): string => resolve(root, options.list ?? 'models.json')
  const cachePath = (): string =>
    resolve(root, options.cache ?? join('.cache', 'models'))
  let listed: ReadonlyArray<ModelFile> = []

  return {
    name: 'intone:models',
    configResolved(config) {
      root = config.root
      base = config.base
      command = config.command
    },
    async buildStart() {
      this.addWatchFile(listPath())
      listed = await readModelList(listPath())
      if (command === 'build') {
        for (const model of listed) {
          await ensureCached(model, cachePath()).catch((error: unknown) =>
            this.error(error instanceof Error ? error.message : String(error)),
          )
        }
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
      return `export const modelUrls = Object.freeze(${JSON.stringify(modelUrls(listed, base))})\n`
    },
    async writeBundle(output) {
      const directory = output.dir ?? resolve(root, 'dist')
      for (const model of listed) {
        const target = join(directory, modelPath(model))
        await mkdir(dirname(target), { recursive: true })
        await copyFile(await ensureCached(model, cachePath()), target)
      }
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const path = (request.url ?? '').split('?')[0] ?? ''
        const models = await readModelList(listPath())
        const model = models.find(each => `${base}${modelPath(each)}` === path)
        if (model === undefined) {
          next()
          return
        }
        try {
          const cached = await ensureCached(model, cachePath())
          response.setHeader('Content-Type', 'application/octet-stream')
          response.setHeader('Content-Length', String(model.bytes))
          await pipeline(createReadStream(cached), response)
        } catch (error) {
          next(error)
        }
      })
    },
  }
}
