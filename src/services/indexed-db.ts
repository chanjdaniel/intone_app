import { Effect, Schema, type Scope } from 'effect'

import { historyFormat } from './history-records'

// The app's own thin way into IndexedDB, on Effect's stable core (never
// `@effect/platform-browser`'s unstable `IndexedDb`): the one database,
// its stores, and a request or a transaction as an Effect. The database's
// version and its upgrade are written here, once, so every store the app
// keeps is in one place.

export class IndexedDbError extends Schema.TaggedError<
  IndexedDbError,
  { readonly brand: unique symbol }
>()('IndexedDbError', { reason: Schema.String }) {}

export const databaseName = 'intone'
export const databaseVersion = 2

export const stores = {
  // Each line's native curve, by the line, its audio and the tracker that
  // made it, so a curve is tracked once per device (./native-curves.ts).
  nativeCurves: 'nativeCurves',
  // The history (./history-store.ts): each take's line, date and score,
  // read whole by the history screens; its curve and features, read only
  // when it is drawn or scored again; the native recordings takes were
  // scored against, each kept once however many takes share it; and the
  // meta records, the history's format and the learner's settings.
  takes: 'takes',
  takeRecordings: 'takeRecordings',
  natives: 'natives',
  meta: 'meta',
} as const
export type Store = (typeof stores)[keyof typeof stores]

// Where the meta store keeps the history's format, written when version
// 2 makes its stores. A later format bumps `databaseVersion`, converts
// the records it changes in `upgrade`, and writes its own number here.
export const formatKey = 'format'

// Brings a database at `oldVersion` up to `databaseVersion`, one version
// at a time, in the upgrade's own transaction.
const upgrade = (
  database: IDBDatabase,
  transaction: IDBTransaction,
  oldVersion: number,
): void => {
  if (oldVersion < 1) {
    database.createObjectStore(stores.nativeCurves)
  }
  if (oldVersion < 2) {
    database.createObjectStore(stores.takes, { keyPath: 'id' })
    database.createObjectStore(stores.takeRecordings, { keyPath: 'id' })
    database.createObjectStore(stores.natives, { keyPath: 'id' })
    database.createObjectStore(stores.meta)
    transaction
      .objectStore(stores.meta)
      .put({ format: historyFormat }, formatKey)
  }
}

const reasonOf = (error: DOMException | null, fallback: string): string =>
  error === null ? fallback : `${error.name}: ${error.message}`

const newerReason =
  "This device's history was saved by a newer copy of Intone. Reload the page to get it."

// The database, open until the scope closes. Another tab that upgrades
// or deletes it closes this connection rather than waiting on it.
export const openDatabase = (
  factory: IDBFactory,
): Effect.Effect<IDBDatabase, IndexedDbError, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.callback<IDBDatabase, IndexedDbError>(resume => {
      const request = factory.open(databaseName, databaseVersion)
      request.onupgradeneeded = event => {
        if (request.transaction !== null) {
          upgrade(request.result, request.transaction, event.oldVersion)
        }
      }
      request.onsuccess = () => {
        const database = request.result
        database.onversionchange = () => database.close()
        resume(Effect.succeed(database))
      }
      request.onerror = () =>
        resume(
          Effect.fail(
            new IndexedDbError({
              reason:
                request.error?.name === 'VersionError'
                  ? newerReason
                  : reasonOf(request.error, 'The database did not open.'),
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

// Runs `body` in one transaction over `names`: it makes its requests at
// once, as IndexedDB requires, and returns how to read their results,
// which is called once the transaction has completed. Nothing is written
// unless all of it is.
export const transact = <A>(
  database: IDBDatabase,
  names: ReadonlyArray<Store>,
  mode: IDBTransactionMode,
  body: (transaction: IDBTransaction) => () => A,
): Effect.Effect<A, IndexedDbError> =>
  Effect.callback<A, IndexedDbError>(resume => {
    const failed = (error: DOMException | null) =>
      resume(
        Effect.fail(
          new IndexedDbError({
            reason: reasonOf(
              error,
              'The history could not be read or written.',
            ),
          }),
        ),
      )
    try {
      const transaction = database.transaction(names, mode)
      const read = body(transaction)
      transaction.oncomplete = () => resume(Effect.sync(read))
      transaction.onerror = () => failed(transaction.error)
      transaction.onabort = () => failed(transaction.error)
    } catch (error) {
      failed(error instanceof DOMException ? error : null)
    }
  })

// The value at `key` in `store`, as stored: undefined when there is none.
export const getRecord = (
  database: IDBDatabase,
  store: Store,
  key: string,
): Effect.Effect<unknown, IndexedDbError> =>
  transact(database, [store], 'readonly', transaction => {
    const request = transaction.objectStore(store).get(key)
    return () => request.result
  })

// Writes `value` at `key` in `store`, done once its transaction is.
export const putRecord = (
  database: IDBDatabase,
  store: Store,
  key: string,
  value: unknown,
): Effect.Effect<void, IndexedDbError> =>
  transact(database, [store], 'readwrite', transaction => {
    transaction.objectStore(store).put(value, key)
    return () => undefined
  })

// Deletes the whole database. A connection open in another tab closes
// itself (`onversionchange` above), so the deletion waits for it.
export const deleteDatabase = (
  factory: IDBFactory,
): Effect.Effect<void, IndexedDbError> =>
  Effect.callback<void, IndexedDbError>(resume => {
    const request = factory.deleteDatabase(databaseName)
    request.onsuccess = () => resume(Effect.void)
    request.onerror = () =>
      resume(
        Effect.fail(
          new IndexedDbError({
            reason: reasonOf(request.error, 'The history was not deleted.'),
          }),
        ),
      )
  })
