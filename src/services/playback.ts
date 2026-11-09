import { Context, Duration, Effect, Layer, Schema } from 'effect'

// Playing a voice back: the native line from its file, at its own speed
// or slowed without changing its pitch, and the learner's take from the
// samples kept in memory. Each play ends when the sound does, and
// stopping it (interrupting the Effect) silences it at once and lets its
// element or AudioContext go.

export class PlaybackError extends Schema.TaggedError<
  PlaybackError,
  { readonly brand: unique symbol }
>()('PlaybackError', { reason: Schema.String }) {}

// The part of an audio element playback uses, so tests can stand one in.
export type MediaElement = Pick<
  HTMLMediaElement,
  | 'play'
  | 'pause'
  | 'load'
  | 'removeAttribute'
  | 'addEventListener'
  | 'removeEventListener'
> & {
  src: string
  playbackRate: number
  defaultPlaybackRate: number
  preservesPitch: boolean
}

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

// Plays `url` once at `rate` times its speed, its pitch kept as it is.
export const playMedia =
  (makeElement: () => MediaElement) =>
  (url: string, rate: number): Effect.Effect<void, PlaybackError> =>
    Effect.scoped(
      Effect.gen(function* () {
        const element = yield* Effect.acquireRelease(
          Effect.sync(makeElement),
          playing =>
            Effect.sync(() => {
              playing.pause()
              playing.removeAttribute('src')
              playing.load()
            }),
        )
        yield* Effect.callback<void, PlaybackError>(resume => {
          const ended = (): void => resume(Effect.void)
          const failed = (): void =>
            resume(
              Effect.fail(
                new PlaybackError({ reason: 'The line did not load.' }),
              ),
            )
          element.addEventListener('ended', ended)
          element.addEventListener('error', failed)
          element.preservesPitch = true
          element.src = url
          // Loading a source resets the rate to the default, so both are
          // set.
          element.defaultPlaybackRate = rate
          element.playbackRate = rate
          element
            .play()
            .catch((error: unknown) =>
              resume(
                Effect.fail(new PlaybackError({ reason: reasonOf(error) })),
              ),
            )
          return Effect.sync(() => {
            element.removeEventListener('ended', ended)
            element.removeEventListener('error', failed)
          })
        })
      }),
    )

// The part of an AudioContext playback uses.
export type PlaybackContext = Pick<
  AudioContext,
  'createBuffer' | 'createBufferSource' | 'destination' | 'close' | 'resume'
>

// Plays `samples`, mono at `sampleRate`, once.
export const playSamples =
  (makeContext: () => PlaybackContext) =>
  (
    samples: Float32Array,
    sampleRate: number,
  ): Effect.Effect<void, PlaybackError> =>
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Effect.acquireRelease(
          Effect.try({
            try: makeContext,
            catch: error => new PlaybackError({ reason: reasonOf(error) }),
          }),
          opened => Effect.promise(() => opened.close().catch(() => undefined)),
        )
        const buffer = yield* Effect.try({
          try: () => {
            const made = context.createBuffer(
              1,
              Math.max(1, samples.length),
              sampleRate,
            )
            made.copyToChannel(Float32Array.from(samples), 0)
            return made
          },
          catch: error => new PlaybackError({ reason: reasonOf(error) }),
        })
        yield* Effect.callback<void, PlaybackError>(resume => {
          const source = context.createBufferSource()
          source.buffer = buffer
          source.connect(context.destination)
          source.addEventListener('ended', () => resume(Effect.void))
          context
            .resume()
            .then(() => source.start())
            .catch((error: unknown) =>
              resume(
                Effect.fail(new PlaybackError({ reason: reasonOf(error) })),
              ),
            )
          return Effect.sync(() => {
            source.disconnect()
          })
        })
      }),
    )

export class Playback extends Context.Service<
  Playback,
  {
    // The native line from its file, `rate` times its speed, its pitch
    // kept.
    readonly playLine: (
      url: string,
      rate: number,
    ) => Effect.Effect<void, PlaybackError>
    // The learner's take, from its samples.
    readonly playTake: (
      samples: Float32Array,
      sampleRate: number,
    ) => Effect.Effect<void, PlaybackError>
  }
>()('intone/services/Playback') {
  // An audio element per line played, an AudioContext per take played.
  static readonly layer = Layer.succeed(
    Playback,
    Playback.of({
      playLine: playMedia(() => new Audio()),
      playTake: playSamples(() => new AudioContext()),
    }),
  )

  // Plays nothing: each play is written to `heard` and lasts as long as
  // its sound would, a line `lineSeconds` at its own speed and a take its
  // samples' length, on the Effect clock.
  static readonly layerTest = (
    heard: Array<Heard>,
    lineSeconds: number,
  ): Layer.Layer<Playback> =>
    Layer.succeed(
      Playback,
      Playback.of({
        playLine: (url, rate) =>
          Effect.sync(() => heard.push({ voice: 'Line', url, rate })).pipe(
            Effect.andThen(Effect.sleep(Duration.seconds(lineSeconds / rate))),
          ),
        playTake: (samples, sampleRate) =>
          Effect.sync(() =>
            heard.push({ voice: 'Take', samples: samples.length, sampleRate }),
          ).pipe(
            Effect.andThen(
              Effect.sleep(Duration.seconds(samples.length / sampleRate)),
            ),
          ),
      }),
    )
}

// What the test layer was asked to play.
export type Heard =
  | Readonly<{ voice: 'Line'; url: string; rate: number }>
  | Readonly<{ voice: 'Take'; samples: number; sampleRate: number }>
