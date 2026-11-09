import { Context, Effect, Layer, Schema } from 'effect'

import type { Recording, Score } from '../score/score'

// Scoring a take against its line: the native's and the take's curves
// and features in, the score out (spec, "Services"), with the take's
// pitch at each of the native's frames through the alignment the score
// made, so the result can draw the take where it was compared. The score
// is plain maths on typed arrays (src/score); a line is a few seconds, so
// it runs where it is asked, in a few milliseconds. The real layer loads
// that maths on the first take, so the app's first screen does not wait
// for it.

export class ScorerError extends Schema.TaggedError<
  ScorerError,
  { readonly brand: unique symbol }
>()('ScorerError', { reason: Schema.String }) {}

export type Comparison = Readonly<{
  score: Score
  // Hz, 0 where unvoiced or not paired, one per native frame; null when
  // the score could not compare.
  alignedTakeF0: Float32Array | null
}>

export class Scorer extends Context.Service<
  Scorer,
  {
    readonly score: (
      native: Recording,
      take: Recording,
    ) => Effect.Effect<Comparison, ScorerError>
  }
>()('intone/services/Scorer') {
  // The score of src/score/score.ts.
  static readonly layer = Layer.succeed(
    Scorer,
    Scorer.of({
      score: (native, take) =>
        Effect.tryPromise({
          try: () => import('./compare-take'),
          catch: () =>
            new ScorerError({
              reason:
                'The scoring code did not load. Reload the page and try again.',
            }),
        }).pipe(
          Effect.flatMap(({ compareTake }) =>
            Effect.try({
              try: () => compareTake(native, take),
              catch: error =>
                new ScorerError({
                  reason: `The take could not be scored: ${error instanceof Error ? error.message : String(error)}`,
                }),
            }),
          ),
        ),
    }),
  )

  // Answers every take with `respond`'s comparison, with no score maths.
  static readonly layerTest = (
    respond: (native: Recording, take: Recording) => Comparison,
  ): Layer.Layer<Scorer> =>
    Layer.succeed(
      Scorer,
      Scorer.of({
        score: (native, take) => Effect.sync(() => respond(native, take)),
      }),
    )
}
