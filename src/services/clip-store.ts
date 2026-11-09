import {
  Context,
  Effect,
  Exit,
  Layer,
  Option,
  Schema,
  type Scope,
} from 'effect'

import { FromClipStore, type Write } from '../workers/clip-store-protocol'

// Audio files kept on the device, in the origin private file system: a
// take's audio when the learner keeps it (./history-store.ts), and the
// clips the learner brings later. A file is written by a Worker, the one
// place every browser lets a page write there (../workers/clip-store.worker.ts),
// and read and deleted from the page itself. Paths are folders and a
// name, such as `takes/abc.wav`; nothing here leaves the device.

export class ClipStoreError extends Schema.TaggedError<
  ClipStoreError,
  { readonly brand: unique symbol }
>()('ClipStoreError', { reason: Schema.String }) {}

const reasonOf = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error)

// A path's parts, refused when it could climb out of its folder or name
// nothing.
const partsOf = (
  path: string,
): Effect.Effect<ReadonlyArray<string>, ClipStoreError> => {
  const parts = path.split('/')
  return parts.length >= 2 &&
    parts.every(part => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part))
    ? Effect.succeed(parts)
    : Effect.fail(new ClipStoreError({ reason: `No such file: ${path}` }))
}

const tryFiles = <A>(
  work: () => Promise<A>,
): Effect.Effect<A, ClipStoreError> =>
  Effect.tryPromise({
    try: work,
    catch: error => new ClipStoreError({ reason: reasonOf(error) }),
  })

const isNotFound = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'NotFoundError'

// The folder holding `parts`' file, if it is there.
const folderOf = async (
  root: FileSystemDirectoryHandle,
  parts: ReadonlyArray<string>,
): Promise<FileSystemDirectoryHandle | null> => {
  try {
    return await parts
      .slice(0, -1)
      .reduce<Promise<FileSystemDirectoryHandle>>(
        async (parent, part) => (await parent).getDirectoryHandle(part),
        Promise.resolve(root),
      )
  } catch (error) {
    if (isNotFound(error)) {
      return null
    }
    throw error
  }
}

// The file at `parts` in the origin private file system, if it is there.
const fileAt = async (parts: ReadonlyArray<string>): Promise<File | null> => {
  const folder = await folderOf(await navigator.storage.getDirectory(), parts)
  if (folder === null) {
    return null
  }
  try {
    const handle = await folder.getFileHandle(parts.at(-1) ?? '')
    return await handle.getFile()
  } catch (error) {
    if (isNotFound(error)) {
      return null
    }
    throw error
  }
}

// An object URL of `blob`, revoked when the scope closes.
const objectUrl = (blob: Blob): Effect.Effect<string, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => URL.createObjectURL(blob)),
    made => Effect.sync(() => URL.revokeObjectURL(made)),
  )

// Writes one file through a Worker of its own, ended once it answers.
const writeInWorker = (message: Write): Effect.Effect<void, ClipStoreError> =>
  Effect.scoped(
    Effect.gen(function* () {
      const worker = yield* Effect.acquireRelease(
        Effect.try({
          try: () =>
            new Worker(
              new URL('../workers/clip-store.worker.ts', import.meta.url),
              { type: 'module', name: 'intone-clip-store' },
            ),
          catch: error => new ClipStoreError({ reason: reasonOf(error) }),
        }),
        worker => Effect.sync(() => worker.terminate()),
      )
      const decode = Schema.decodeUnknownExit(FromClipStore)
      const answer = yield* Effect.callback<FromClipStore>(resume => {
        worker.addEventListener('message', event => {
          resume(
            Effect.succeed(
              Exit.match(decode(event.data), {
                onSuccess: reply => reply,
                onFailure: () => ({
                  _tag: 'WriteFailed' as const,
                  reason: 'The clip store answered nonsense.',
                }),
              }),
            ),
          )
        })
        worker.addEventListener('error', event => {
          resume(
            Effect.succeed({
              _tag: 'WriteFailed' as const,
              reason:
                event.message === ''
                  ? 'The clip store stopped.'
                  : event.message,
            }),
          )
        })
        worker.postMessage(message, [message.bytes.buffer])
      })
      if (answer._tag === 'WriteFailed') {
        return yield* new ClipStoreError({ reason: answer.reason })
      }
    }),
  )

export class ClipStore extends Context.Service<
  ClipStore,
  {
    // Writes `bytes` at `path`, replacing what was there. The bytes are
    // handed over: the caller must not use them again.
    readonly write: (
      path: string,
      bytes: Uint8Array,
    ) => Effect.Effect<void, ClipStoreError>
    // The file at `path`, if there is one.
    readonly read: (
      path: string,
    ) => Effect.Effect<Option.Option<Uint8Array>, ClipStoreError>
    // A URL the page can play the file at `path` from, with the media
    // type `type`, valid until the scope closes; none when there is no
    // file. The file is not read into memory for it.
    readonly url: (
      path: string,
      type: string,
    ) => Effect.Effect<Option.Option<string>, ClipStoreError, Scope.Scope>
    // Deletes the file at `path`; a file not there is already deleted.
    readonly remove: (path: string) => Effect.Effect<void, ClipStoreError>
    // Deletes every file.
    readonly clear: Effect.Effect<void, ClipStoreError>
  }
>()('intone/services/ClipStore') {
  static readonly layer = Layer.succeed(
    ClipStore,
    ClipStore.of({
      write: (path, bytes) =>
        partsOf(path).pipe(
          Effect.flatMap(parts =>
            writeInWorker({ _tag: 'Write', path: parts, bytes }),
          ),
        ),
      read: path =>
        partsOf(path).pipe(
          Effect.flatMap(parts =>
            tryFiles(async () => {
              const file = await fileAt(parts)
              return file === null
                ? Option.none()
                : Option.some(new Uint8Array(await file.arrayBuffer()))
            }),
          ),
        ),
      url: (path, type) =>
        partsOf(path).pipe(
          Effect.flatMap(parts => tryFiles(() => fileAt(parts))),
          Effect.flatMap(file =>
            file === null
              ? Effect.succeedNone
              : objectUrl(
                  type === '' || file.type === type
                    ? file
                    : new Blob([file], { type }),
                ).pipe(Effect.asSome),
          ),
        ),
      remove: path =>
        partsOf(path).pipe(
          Effect.flatMap(parts =>
            tryFiles(async () => {
              const folder = await folderOf(
                await navigator.storage.getDirectory(),
                parts,
              )
              try {
                await folder?.removeEntry(parts.at(-1) ?? '')
              } catch (error) {
                if (!isNotFound(error)) {
                  throw error
                }
              }
            }),
          ),
        ),
      clear: tryFiles(async () => {
        const root = await navigator.storage.getDirectory()
        const names: Array<string> = []
        for await (const name of root.keys()) {
          names.push(name)
        }
        await Promise.all(
          names.map(name => root.removeEntry(name, { recursive: true })),
        )
      }),
    }),
  )

  // A map in memory standing in for the file system: `files` holds what
  // is stored, by path, so a test can see it.
  static readonly layerMemory = (
    files: Map<string, Uint8Array>,
  ): Layer.Layer<ClipStore> =>
    Layer.succeed(
      ClipStore,
      ClipStore.of({
        write: (path, bytes) =>
          partsOf(path).pipe(
            Effect.map(() => {
              files.set(path, Uint8Array.from(bytes))
            }),
          ),
        read: path =>
          partsOf(path).pipe(
            Effect.map(() =>
              Option.map(Option.fromNullishOr(files.get(path)), bytes =>
                Uint8Array.from(bytes),
              ),
            ),
          ),
        url: (path, type) =>
          partsOf(path).pipe(
            Effect.flatMap(() => {
              const bytes = files.get(path)
              return bytes === undefined
                ? Effect.succeedNone
                : objectUrl(new Blob([Uint8Array.from(bytes)], { type })).pipe(
                    Effect.asSome,
                  )
            }),
          ),
        remove: path =>
          partsOf(path).pipe(
            Effect.map(() => {
              files.delete(path)
            }),
          ),
        clear: Effect.sync(() => files.clear()),
      }),
    )
}
