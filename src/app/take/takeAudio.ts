import { Effect, Option, Ref } from 'effect'

// The last take's audio, in memory only: never stored, never sent. The
// recording Subscription keeps a copy of each batch here before handing
// it to the tracker, so the learner can hear their take; a new take
// replaces it, and leaving the line forgets it.

export type TakeAudio = Readonly<{ samples: Float32Array; sampleRate: number }>

type Kept = Readonly<{
  takeNumber: number
  sampleRate: number
  parts: Array<Float32Array>
}>

const current = Ref.makeUnsafe<Option.Option<Kept>>(Option.none())

// Starts keeping take `takeNumber`'s audio, at `sampleRate`, in place of
// any earlier take's: the function that keeps each batch.
export const keepTakeAudio = (
  takeNumber: number,
  sampleRate: number,
): Effect.Effect<(batch: Float32Array) => Effect.Effect<void>> =>
  Effect.gen(function* () {
    const take: Kept = { takeNumber, sampleRate, parts: [] }
    yield* Ref.set(current, Option.some(take))
    return batch =>
      Effect.sync(() => {
        take.parts.push(Float32Array.from(batch))
      })
  })

const joined = (parts: ReadonlyArray<Float32Array>): Float32Array => {
  const samples = new Float32Array(
    parts.reduce((length, part) => length + part.length, 0),
  )
  parts.reduce((offset, part) => {
    samples.set(part, offset)
    return offset + part.length
  }, 0)
  return samples
}

// Take `takeNumber`'s audio, while it is the last take's.
export const takeAudioOf = (
  takeNumber: number,
): Effect.Effect<Option.Option<TakeAudio>> =>
  Ref.get(current).pipe(
    Effect.map(
      Option.flatMap(take =>
        take.takeNumber === takeNumber
          ? Option.some({
              samples: joined(take.parts),
              sampleRate: take.sampleRate,
            })
          : Option.none(),
      ),
    ),
  )

export const forgetTakeAudio: Effect.Effect<void> = Ref.set(
  current,
  Option.none(),
)
