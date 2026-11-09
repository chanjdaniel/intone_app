import { Context, Duration, Effect, Layer, Schema } from 'effect'

// Playing a voice back: the native line from its file, at its own speed
// or slowed without changing its pitch, and the learner's take from the
// samples kept in memory, each whole or one stretch of it. Each play
// ends when the sound does, and stopping it (interrupting the Effect)
// silences it at once and lets its element or AudioContext go.

export class PlaybackError extends Schema.TaggedError<
  PlaybackError,
  { readonly brand: unique symbol }
>()('PlaybackError', { reason: Schema.String }) {}

// Seconds from the start of a recording: the part of it to play.
export type Stretch = Readonly<{ from: number; to: number }>

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
  currentTime: number
  playbackRate: number
  defaultPlaybackRate: number
  preservesPitch: boolean
}

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

// Plays `url` once at `rate` times its speed, its pitch kept as it is:
// whole, or from a stretch's start for as long as it lasts at that rate,
// timed from when the sound starts.
export const playMedia =
  (makeElement: () => MediaElement) =>
  (
    url: string,
    rate: number,
    stretch?: Stretch,
  ): Effect.Effect<void, PlaybackError> =>
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
        const heard = (type: string): Effect.Effect<void> =>
          Effect.callback<void>(resume => {
            const listener = (): void => resume(Effect.void)
            element.addEventListener(type, listener)
            return Effect.sync(() => {
              element.removeEventListener(type, listener)
            })
          })
        const failed = heard('error').pipe(
          Effect.andThen(
            Effect.fail(
              new PlaybackError({ reason: 'The line did not load.' }),
            ),
          ),
        )
        const ended = heard('ended')
        const done =
          stretch === undefined
            ? ended
            : Effect.raceFirst(
                ended,
                heard('playing').pipe(
                  Effect.andThen(
                    Effect.sleep(
                      Duration.millis(
                        (1000 * Math.max(0, stretch.to - stretch.from)) / rate,
                      ),
                    ),
                  ),
                ),
              )
        const play = Effect.callback<never, PlaybackError>(resume => {
          element.preservesPitch = true
          element.src = url
          if (stretch !== undefined) {
            element.currentTime = stretch.from
          }
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
        })
        // NOTE: a media element fires its events from queued tasks, never
        // during `play()` itself, so every listener is in place first.
        yield* Effect.raceFirst(Effect.raceFirst(done, failed), play)
      }),
    )

// The part of an AudioContext playback uses.
export type PlaybackContext = Pick<
  AudioContext,
  'createBuffer' | 'createBufferSource' | 'destination' | 'close' | 'resume'
>

// Plays `samples`, mono at `sampleRate`, once: whole, or one stretch.
export const playSamples =
  (makeContext: () => PlaybackContext) =>
  (
    samples: Float32Array,
    sampleRate: number,
    stretch?: Stretch,
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
        const played =
          stretch === undefined
            ? Float32Array.from(samples)
            : samples.slice(
                Math.max(0, Math.round(stretch.from * sampleRate)),
                Math.max(0, Math.round(stretch.to * sampleRate)),
              )
        const buffer = yield* Effect.try({
          try: () => {
            const made = context.createBuffer(
              1,
              Math.max(1, played.length),
              sampleRate,
            )
            made.copyToChannel(played, 0)
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

const stretchSeconds = (
  stretch: Stretch | undefined,
  wholeSeconds: number,
): number =>
  stretch === undefined ? wholeSeconds : Math.max(0, stretch.to - stretch.from)

export class Playback extends Context.Service<
  Playback,
  {
    // The native line from its file, `rate` times its speed, its pitch
    // kept, whole or one stretch.
    readonly playLine: (
      url: string,
      rate: number,
      stretch?: Stretch,
    ) => Effect.Effect<void, PlaybackError>
    // The learner's take, from its samples, whole or one stretch.
    readonly playTake: (
      samples: Float32Array,
      sampleRate: number,
      stretch?: Stretch,
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
  // its sound would, a line `lineSeconds` at its own speed, a take its
  // samples' length, and a stretch its own, on the Effect clock.
  static readonly layerTest = (
    heard: Array<Heard>,
    lineSeconds: number,
  ): Layer.Layer<Playback> =>
    Layer.succeed(
      Playback,
      Playback.of({
        playLine: (url, rate, stretch) =>
          Effect.sync(() =>
            heard.push(
              stretch === undefined
                ? { voice: 'Line', url, rate }
                : { voice: 'Line', url, rate, stretch },
            ),
          ).pipe(
            Effect.andThen(
              Effect.sleep(
                Duration.millis(
                  (1000 * stretchSeconds(stretch, lineSeconds)) / rate,
                ),
              ),
            ),
          ),
        playTake: (samples, sampleRate, stretch) =>
          Effect.sync(() =>
            heard.push(
              stretch === undefined
                ? { voice: 'Take', samples: samples.length, sampleRate }
                : {
                    voice: 'Take',
                    samples: samples.length,
                    sampleRate,
                    stretch,
                  },
            ),
          ).pipe(
            Effect.andThen(
              Effect.sleep(
                Duration.millis(
                  1000 * stretchSeconds(stretch, samples.length / sampleRate),
                ),
              ),
            ),
          ),
      }),
    )
}

// What the test layer was asked to play.
export type Heard =
  | Readonly<{ voice: 'Line'; url: string; rate: number; stretch?: Stretch }>
  | Readonly<{
      voice: 'Take'
      samples: number
      sampleRate: number
      stretch?: Stretch
    }>
