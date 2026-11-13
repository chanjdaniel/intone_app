import { Context, Effect, Layer, Option, Schema } from 'effect'

import { getRecord, openDatabase, putRecord, stores } from './indexed-db'
import { ReviewExportVerdict } from './starter-records'

// The starter review's verdicts as the review page (src/app/review/)
// keeps them on the device while the review runs: in IndexedDB's meta
// store, under a key of its own, decoded by its Schema on every read, so
// a reload or a second sitting carries on where the last left off. A
// record that does not decode reads as no verdicts. Clearing all data
// deletes them with the rest of the database; the export file is the
// review's one copy that leaves the browser.

export class ReviewStoreError extends Schema.TaggedError<
  ReviewStoreError,
  { readonly brand: unique symbol }
>()('ReviewStoreError', { reason: Schema.String }) {}

export const ReviewDraft = Schema.Struct({
  reviewer: Schema.String,
  // At most one a line, in the order they were given.
  verdicts: Schema.Array(ReviewExportVerdict),
})
export type ReviewDraft = typeof ReviewDraft.Type

export const emptyReviewDraft: ReviewDraft = { reviewer: '', verdicts: [] }

export const reviewKey = 'starterReview'

const decode = Schema.decodeUnknownOption(ReviewDraft)

// An undecodable record is as good as none.
const readDraft = (record: unknown): ReviewDraft =>
  Option.getOrElse(decode(record), () => emptyReviewDraft)

export class ReviewStore extends Context.Service<
  ReviewStore,
  {
    readonly draft: Effect.Effect<ReviewDraft, ReviewStoreError>
    readonly setDraft: (
      draft: ReviewDraft,
    ) => Effect.Effect<void, ReviewStoreError>
  }
>()('intone/services/ReviewStore') {
  // The browser's IndexedDB, opened for each read or write.
  static readonly layer = Layer.succeed(
    ReviewStore,
    ReviewStore.of({
      // Suspended, so the browser's indexedDB is read when the draft is,
      // never when this module loads.
      draft: Effect.suspend(() =>
        Effect.scoped(
          openDatabase(indexedDB).pipe(
            Effect.flatMap(database =>
              getRecord(database, stores.meta, reviewKey),
            ),
          ),
        ),
      ).pipe(
        Effect.map(readDraft),
        Effect.mapError(
          error =>
            new ReviewStoreError({
              reason: `The review could not be read. ${error.reason}`,
            }),
        ),
      ),
      setDraft: draft =>
        Effect.scoped(
          openDatabase(indexedDB).pipe(
            // The draft's encoded form is itself: plain strings and
            // numbers.
            Effect.flatMap(database =>
              putRecord(database, stores.meta, reviewKey, draft),
            ),
          ),
        ).pipe(
          Effect.mapError(
            error =>
              new ReviewStoreError({
                reason: `The review was not kept. ${error.reason}`,
              }),
          ),
        ),
    }),
  )

  // A map in memory standing in for IndexedDB's meta store, so a test can
  // plant a record or read what was kept.
  static readonly layerMemory = (
    records: Map<string, unknown>,
  ): Layer.Layer<ReviewStore> =>
    Layer.succeed(
      ReviewStore,
      ReviewStore.of({
        draft: Effect.sync(() => readDraft(records.get(reviewKey))),
        setDraft: draft =>
          Effect.sync(() => {
            records.set(reviewKey, structuredClone(draft))
          }),
      }),
    )
}
