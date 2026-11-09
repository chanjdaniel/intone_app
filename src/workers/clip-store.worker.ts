import { Effect, Exit, Schema } from 'effect'

import { type FromClipStore, Write } from './clip-store-protocol'

// Writes one file into the origin private file system: a synchronous
// access handle, the one way to write a file there that every browser
// with the file system has, works only in a Worker. The main thread reads
// and deletes the files itself (../services/clip-store.ts).

const post = (message: FromClipStore): void => {
  self.postMessage(message)
}

const reasonOf = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error)

const writeFile = async ({ path, bytes }: Write): Promise<void> => {
  const folders = path.slice(0, -1)
  const name = path.at(-1)
  if (name === undefined) {
    throw new Error('The file has no name.')
  }
  const root = await navigator.storage.getDirectory()
  const folder = await folders.reduce<Promise<FileSystemDirectoryHandle>>(
    async (parent, part) =>
      (await parent).getDirectoryHandle(part, { create: true }),
    Promise.resolve(root),
  )
  const file = await folder.getFileHandle(name, { create: true })
  if (!hasSyncAccess(file)) {
    throw new Error('This browser cannot write files here.')
  }
  const handle = await file.createSyncAccessHandle()
  try {
    handle.truncate(0)
    handle.write(bytes, { at: 0 })
    handle.flush()
  } finally {
    handle.close()
  }
}

// NOTE: the app's type check uses the page's DOM types, which leave out
// what only a Worker has.
type SyncAccessHandle = Readonly<{
  truncate: (size: number) => void
  write: (bytes: Uint8Array, options: { at: number }) => number
  flush: () => void
  close: () => void
}>
type WorkerFileHandle = FileSystemFileHandle &
  Readonly<{ createSyncAccessHandle: () => Promise<SyncAccessHandle> }>

const hasSyncAccess = (
  handle: FileSystemFileHandle,
): handle is WorkerFileHandle => 'createSyncAccessHandle' in handle

const decode = Schema.decodeUnknownExit(Write)

self.addEventListener('message', (event: MessageEvent) => {
  Exit.match(decode(event.data), {
    onFailure: () =>
      post({
        _tag: 'WriteFailed',
        reason: 'The clip store was sent nonsense.',
      }),
    onSuccess: message => {
      void Effect.runPromise(
        Effect.tryPromise({
          try: () => writeFile(message),
          catch: reasonOf,
        }).pipe(
          Effect.match({
            onSuccess: () => post({ _tag: 'Written' }),
            onFailure: reason => post({ _tag: 'WriteFailed', reason }),
          }),
        ),
      )
    },
  })
})
