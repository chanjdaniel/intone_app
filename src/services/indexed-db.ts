import { Effect, Schema, type Scope } from 'effect'

// The app's own thin way into IndexedDB, on Effect's stable core (never
// `@effect/platform-browser`'s unstable `IndexedDb`): the one database,
// its stores, and a request as an Effect. The database's version and its
// upgrade are written here, once, so every store the app keeps is in one
// place.

export class IndexedDbError extends Schema.TaggedError<
  IndexedDbError,
  { readonly brand: unique symbol }
>()('IndexedDbError', { reason: Schema.String }) {}

export const databaseName = 'intone'
export const databaseVersion = 1

export const stores = {
  // Each line's native curve, by the line, its audio and the tracker that
  // made it, so a curve is tracked once per device (./native-curves.ts).
  nativeCurves: 'nativeCurves',
} as const
export type Store = (typeof stores)[keyof typeof stores]

// Brings a database at `oldVersion` up to `databaseVersion`, one version
// at a time.
const upgrade = (database: IDBDatabase, oldVersion: number): void => {
  if (oldVersion < 1) {
    database.createObjectStore(stores.nativeCurves)
  }
}

const reasonOf = (error: DOMException | null, fallback: string): string =>
  error === null ? fallback : `${error.name}: ${error.message}`

// The database, open until the scope closes.
export const openDatabase = (
  factory: IDBFactory,
): Effect.Effect<IDBDatabase, IndexedDbError, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.callback<IDBDatabase, IndexedDbError>(resume => {
      const request = factory.open(databaseName, databaseVersion)
      request.onupgradeneeded = event => {
        upgrade(request.result, event.oldVersion)
      }
      request.onsuccess = () => resume(Effect.succeed(request.result))
      request.onerror = () =>
        resume(
          Effect.fail(
            new IndexedDbError({
              reason: reasonOf(request.error, 'The database did not open.'),
            }),
          ),
        )
      request.onblocked = () =>
        resume(
          Effect.fail(
            new IndexedDbError({
              reason: 'The database is held open by an older copy of the app.',
            }),
          ),
        )
    }),
    database => Effect.sync(() => database.close()),
  )

// The value at `key` in `store`, as stored: undefined when there is none.
export const getRecord = (
  database: IDBDatabase,
  store: Store,
  key: string,
): Effect.Effect<unknown, IndexedDbError> =>
  Effect.callback<unknown, IndexedDbError>(resume => {
    const request = database
      .transaction(store, 'readonly')
      .objectStore(store)
      .get(key)
    request.onsuccess = () => resume(Effect.succeed(request.result))
    request.onerror = () =>
      resume(
        Effect.fail(
          new IndexedDbError({
            reason: reasonOf(request.error, 'The record did not read.'),
          }),
        ),
      )
  })

// Writes `value` at `key` in `store`, done once its transaction is.
export const putRecord = (
  database: IDBDatabase,
  store: Store,
  key: string,
  value: unknown,
): Effect.Effect<void, IndexedDbError> =>
  Effect.callback<void, IndexedDbError>(resume => {
    const transaction = database.transaction(store, 'readwrite')
    transaction.objectStore(store).put(value, key)
    transaction.oncomplete = () => resume(Effect.void)
    const failed = () =>
      resume(
        Effect.fail(
          new IndexedDbError({
            reason: reasonOf(transaction.error, 'The record was not written.'),
          }),
        ),
      )
    transaction.onerror = failed
    transaction.onabort = failed
  })
