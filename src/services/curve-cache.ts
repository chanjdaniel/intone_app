import { Context, Effect, Layer, Option, Schema } from 'effect'

import type { Curve } from '../score/curve'
import { getRecord, openDatabase, putRecord, stores } from './indexed-db'

// Native curves kept on the device, so each line is tracked once: in
// IndexedDB, as a versioned record decoded by its Schema on every read.
// A record that does not decode (an older format, or a damaged one) reads
// as no record, so the line is tracked again and the record replaced.

export class CurveCacheError extends Schema.TaggedError<
  CurveCacheError,
  { readonly brand: unique symbol }
>()('CurveCacheError', { reason: Schema.String }) {}

const Frames = Schema.instanceOf(Float32Array<ArrayBufferLike>)

// Format 1: the curve's fields as the tracker gave them.
export const StoredCurve = Schema.Struct({
  format: Schema.Literal(1),
  frameHz: Schema.Finite,
  f0Hz: Frames,
  confidence: Frames,
  levelDb: Frames,
  onsetFrame: Schema.Finite,
})
export type StoredCurve = typeof StoredCurve.Type

const decode = Schema.decodeUnknownOption(StoredCurve)

export const storedCurveOf = (curve: Curve): StoredCurve => ({
  format: 1,
  frameHz: curve.frameHz,
  f0Hz: curve.f0Hz,
  confidence: curve.confidence,
  levelDb: curve.levelDb,
  onsetFrame: curve.onsetFrame,
})

const curveOf = (stored: StoredCurve): Curve => ({
  frameHz: stored.frameHz,
  f0Hz: stored.f0Hz,
  confidence: stored.confidence,
  levelDb: stored.levelDb,
  onsetFrame: stored.onsetFrame,
})

export class CurveCache extends Context.Service<
  CurveCache,
  {
    // The curve kept at `key`, if one is and it decodes.
    readonly get: (
      key: string,
    ) => Effect.Effect<Option.Option<Curve>, CurveCacheError>
    readonly put: (
      key: string,
      curve: Curve,
    ) => Effect.Effect<void, CurveCacheError>
  }
>()('intone/services/CurveCache') {
  // The browser's IndexedDB, the database opened for each read or write.
  static readonly layer = Layer.succeed(
    CurveCache,
    CurveCache.of({
      get: key =>
        Effect.scoped(
          openDatabase(indexedDB).pipe(
            Effect.flatMap(database =>
              getRecord(database, stores.nativeCurves, key),
            ),
          ),
        ).pipe(
          Effect.map(record => Option.map(decode(record), curveOf)),
          Effect.mapError(
            error => new CurveCacheError({ reason: error.reason }),
          ),
        ),
      put: (key, curve) =>
        Effect.scoped(
          openDatabase(indexedDB).pipe(
            Effect.flatMap(database =>
              putRecord(
                database,
                stores.nativeCurves,
                key,
                storedCurveOf(curve),
              ),
            ),
          ),
        ).pipe(
          Effect.mapError(
            error => new CurveCacheError({ reason: error.reason }),
          ),
        ),
    }),
  )

  // A map in memory standing in for IndexedDB: `records` holds what is
  // stored, as IndexedDB would, so a test can plant a record.
  static readonly layerMemory = (
    records: Map<string, unknown>,
  ): Layer.Layer<CurveCache> =>
    Layer.succeed(
      CurveCache,
      CurveCache.of({
        get: key =>
          Effect.sync(() => Option.map(decode(records.get(key)), curveOf)),
        put: (key, curve) =>
          Effect.sync(() => {
            records.set(key, storedCurveOf(curve))
          }),
      }),
    )
}
