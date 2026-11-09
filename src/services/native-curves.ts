import { Context, Effect, Layer, Option, Schema } from 'effect'
import { modelUrls } from 'virtual:intone/models'

import { decodeWav } from '../engine/audio/wav'
import type { Recording } from '../score/score'
import { CurveCache } from './curve-cache'
import { Tracker, recordingOfTracked } from './tracker'

// A line's native curve and its features, for the score: tracked from
// the line's own audio by the same tracker a take goes through, once per
// device, then read from the device. The cache's key names the line, its audio file and the tracker
// model, so a new recording or a new model is tracked afresh.

export class NativeCurveError extends Schema.TaggedError<
  NativeCurveError,
  { readonly brand: unique symbol }
>()('NativeCurveError', { reason: Schema.String }) {}

// Where a line's audio is, and the key it is known by.
export type NativeLine = Readonly<{ key: string; audioUrl: string }>

export type LineAudio = Readonly<{ samples: Float32Array; sampleRate: number }>

// The version of the tracking a native curve went through: raise it when
// that changes in a way the model's URL does not show, so every device
// tracks its lines again.
export const nativeTrackingVersion = 1

export const cacheKeyOf = (line: NativeLine, trackerId: string): string =>
  JSON.stringify([nativeTrackingVersion, line.key, line.audioUrl, trackerId])

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

// The line's file, fetched from the app's own origin and decoded to mono.
export const fetchLineAudio = (
  url: string,
): Effect.Effect<LineAudio, NativeCurveError> =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`the server answered ${response.status}`)
      }
      const wav = decodeWav(new Uint8Array(await response.arrayBuffer()))
      const [first, ...others] = wav.channels
      const samples = Float32Array.from(
        first ?? [],
        (sample, i) =>
          others.reduce((sum, channel) => sum + (channel[i] ?? 0), sample) /
          wav.channels.length,
      )
      return { samples, sampleRate: wav.sampleRate }
    },
    catch: error =>
      new NativeCurveError({
        reason: `The line's audio did not load: ${reasonOf(error)}`,
      }),
  })

export class NativeCurves extends Context.Service<
  NativeCurves,
  {
    // The line's native curve and features, from the device or tracked
    // now.
    readonly recordingOf: (
      line: NativeLine,
    ) => Effect.Effect<Recording, NativeCurveError>
  }
>()('intone/services/NativeCurves') {
  // Tracks with the tracker in `Tracker`, keeps curves in `CurveCache`,
  // loads audio with `loadAudio`; `trackerId` names the tracker in the
  // cache's keys.
  static readonly make = (
    loadAudio: (url: string) => Effect.Effect<LineAudio, NativeCurveError>,
    trackerId: string,
  ): Layer.Layer<NativeCurves, never, Tracker | CurveCache> =>
    Layer.effect(
      NativeCurves,
      Effect.gen(function* () {
        const tracker = yield* Tracker
        const cache = yield* CurveCache

        const track = (line: NativeLine) =>
          Effect.gen(function* () {
            const audio = yield* loadAudio(line.audioUrl)
            const result = yield* Effect.scoped(
              Effect.gen(function* () {
                const session = yield* tracker.open
                yield* session.start(audio.sampleRate)
                yield* session.push(audio.samples)
                return yield* session.finish
              }),
            ).pipe(
              Effect.mapError(
                error =>
                  new NativeCurveError({
                    reason: `The line could not be tracked: ${error.reason}`,
                  }),
              ),
            )
            if (result._tag !== 'Tracked') {
              return yield* new NativeCurveError({
                reason: `The line could not be tracked: it was ${result._tag === 'TooQuiet' ? 'too quiet' : 'too noisy'}.`,
              })
            }
            return recordingOfTracked(result)
          })

        return NativeCurves.of({
          recordingOf: line =>
            Effect.gen(function* () {
              const key = cacheKeyOf(line, trackerId)
              // NOTE: a cache that cannot be read or written (storage
              // turned off, or full) only costs tracking the line again.
              const kept = yield* cache
                .get(key)
                .pipe(Effect.orElseSucceed(() => Option.none<Recording>()))
              if (Option.isSome(kept)) {
                return kept.value
              }
              const recording = yield* track(line)
              yield* cache.put(key, recording).pipe(Effect.ignore)
              return recording
            }),
        })
      }),
    )

  // SwiftF0 in its Worker, the line from the app's origin, curves in
  // IndexedDB.
  static readonly layer = NativeCurves.make(
    fetchLineAudio,
    modelUrls['swift-f0'],
  ).pipe(Layer.provide([Tracker.layer, CurveCache.layer]))

  // Answers each line with `recordingOf`, with no tracker, audio or
  // storage.
  static readonly layerTest = (
    recordingOf: (
      line: NativeLine,
    ) => Effect.Effect<Recording, NativeCurveError>,
  ): Layer.Layer<NativeCurves> =>
    Layer.succeed(NativeCurves, NativeCurves.of({ recordingOf }))
}
