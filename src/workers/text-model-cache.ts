import { Effect, Schema } from 'effect'

import { filesBytes } from '../engine/files'
import { reasonOf } from '../engine/reason'
import type { TextModel } from './text-protocol'

// A text model's files on the device: fetched once from the app's own
// origin into Transformers.js's own browser cache, the Cache API store it
// reads before it fetches anything, under the very key it looks a local
// model's file up by (its local model path and the file's path), so a
// file too large for the browser's HTTP cache is still never fetched
// twice. The text Worker fetches them itself, rather than through
// Transformers.js, to report the bytes against the sizes models.json
// gives, to stop at once when asked, and because Transformers.js, given
// a progress callback, first fetches every file once more to learn its
// size (docs/transcription.md).

// The Cache API store Transformers.js keeps the files in (its
// `env.cacheKey`), which clearing all data deletes.
export const textModelCacheName = 'intone-text-models'

export class TextModelFetchError extends Schema.TaggedError<
  TextModelFetchError,
  { readonly brand: unique symbol }
>()('TextModelFetchError', { reason: Schema.String }) {}

// The key Transformers.js 4.3.2 looks a file up by: its `localModelPath`,
// the model's name and the file's path, joined (`buildResourcePaths`).
export const cacheKeyOf = (
  modelsRoot: string,
  model: TextModel,
  path: string,
): string => `${modelsRoot}${model.name}/${path}`

export type DownloadProgress = (done: number, total: number) => void

const fetched = async (
  key: string,
  bytes: number,
  signal: AbortSignal,
  onBytes: (count: number) => void,
): Promise<Response> => {
  const response = await fetch(key, { signal })
  if (!response.ok || response.body === null) {
    throw new Error(`${key} answered ${response.status}.`)
  }
  const chunks: Array<Uint8Array<ArrayBuffer>> = []
  const reader = response.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    chunks.push(value)
    onBytes(value.length)
  }
  const got = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  if (got !== bytes) {
    throw new Error(`${key} gave ${got} bytes, where ${bytes} were listed.`)
  }
  return new Response(new Blob(chunks), {
    headers: {
      'Content-Type':
        response.headers.get('Content-Type') ?? 'application/octet-stream',
      'Content-Length': String(bytes),
    },
  })
}

// Deletes every text model's files from the device, as clearing all data
// does; a browser with no Cache API has none to delete.
export const deleteTextModels: Effect.Effect<void> = Effect.promise(() =>
  'caches' in globalThis
    ? caches.delete(textModelCacheName).catch(() => false)
    : Promise.resolve(false),
).pipe(Effect.asVoid)

// Whether every file of `model` is in the cache, so a job with it
// downloads nothing; a browser with no Cache API, or a store that cannot
// be read, has none.
export const isTextModelKept = (
  modelsRoot: string,
  model: TextModel,
): Effect.Effect<boolean> =>
  Effect.promise(async () => {
    if (!('caches' in globalThis)) {
      return false
    }
    const cache = await caches.open(textModelCacheName)
    const found = await Promise.all(
      model.files.map(file =>
        cache.match(cacheKeyOf(modelsRoot, model, file.path)),
      ),
    )
    return found.every(response => response !== undefined)
  }).pipe(Effect.catchDefect(() => Effect.succeed(false)))

// Every file of `model` in the cache, the ones already there counted as
// done; interrupting it aborts the file being fetched.
export const ensureTextModel = (
  modelsRoot: string,
  model: TextModel,
  progress: DownloadProgress,
): Effect.Effect<void, TextModelFetchError> =>
  Effect.tryPromise({
    try: async signal => {
      const cache = await caches.open(textModelCacheName)
      const total = filesBytes(model.files)
      const state = { done: 0 }
      progress(0, total)
      for (const file of model.files) {
        const key = cacheKeyOf(modelsRoot, model, file.path)
        if ((await cache.match(key)) !== undefined) {
          state.done += file.bytes
          progress(state.done, total)
          continue
        }
        const response = await fetched(key, file.bytes, signal, count => {
          state.done += count
          progress(state.done, total)
        })
        await cache.put(key, response)
      }
    },
    catch: error =>
      new TextModelFetchError({
        reason: `The text model could not be downloaded: ${reasonOf(error)}`,
      }),
  })
