import { Effect, Option, type Scope, Stream, SubscriptionRef } from 'effect'

import type { LiveFrames } from '../../services/tracker'

// Where the live curve's canvas finds its take's frames. A Mount runs
// with no services, so it cannot ask for the tracker resource as the
// Subscription does; instead the tracker resource, once acquired, puts
// its take's frames here for as long as it holds the Worker, and the
// canvas's Mount waits for the take it was made for.

type LiveTake = Readonly<{
  takeNumber: number
  frames: Stream.Stream<LiveFrames>
}>

const current = Effect.runSync(
  SubscriptionRef.make<Option.Option<LiveTake>>(Option.none()),
)

// Offers `frames` as take `takeNumber`'s until the scope closes.
export const offerLiveFrames = (
  takeNumber: number,
  frames: Stream.Stream<LiveFrames>,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.acquireRelease(
    SubscriptionRef.set(current, Option.some({ takeNumber, frames })),
    () =>
      SubscriptionRef.update(current, maybeTake =>
        Option.filter(maybeTake, take => take.takeNumber !== takeNumber),
      ),
  )

// Take `takeNumber`'s frames, once they are offered.
export const liveFramesOf = (
  takeNumber: number,
): Effect.Effect<Stream.Stream<LiveFrames>> =>
  SubscriptionRef.changes(current).pipe(
    Stream.map(Option.filter(take => take.takeNumber === takeNumber)),
    Stream.filter(Option.isSome),
    Stream.runHead,
    Effect.map(
      Option.match({
        onNone: () => Stream.empty,
        onSome: offered => offered.value.frames,
      }),
    ),
  )
