import { Duration, Effect, Exit, Queue, Schema, type Scope } from 'effect'

import { reasonOf } from '../engine/reason'

// The page's side of a Worker of the project's own protocol (AGENTS.md,
// "Effect"), which the tracker (./tracker.ts) and the clip analyser
// (./clip-analyser.ts) open: the Worker made, its replies decoded into a
// queue as its message listener gets them, a `Load` posted and its
// `Loaded` awaited, until the scope closes. Then the Worker is asked to
// `Close`, given two seconds to say `Closed` and free its models, and
// terminated either way.

// The part of a Worker a session uses, so tests can stand one in.
export type WorkerPort = Pick<
  Worker,
  'postMessage' | 'addEventListener' | 'removeEventListener' | 'terminate'
>

type Tagged = Readonly<{ _tag: string }>

// What every protocol's Worker may say, and what the session says for a
// Worker that stopped or sent what it should not have.
type Failed = Readonly<{ _tag: 'Failed'; reason: string }>

export type WorkerSession<Request, Reply, E> = Readonly<{
  post: (request: Request) => Effect.Effect<void>
  // The next reply, when `accept` takes it; any other, a `Failed` or one
  // out of turn, fails with its reason.
  reply: <A>(accept: (reply: Reply) => A | undefined) => Effect.Effect<A, E>
  // The next reply, whatever it is.
  next: Effect.Effect<Reply>
}>

// How long a released Worker has to free its models before it is
// terminated anyway.
const closeGrace = Duration.seconds(2)

export const openWorkerSession = <
  Request extends Tagged,
  Reply extends Tagged,
  E,
>(options: {
  // Who the failures name: "The tracker", "The clip analyser".
  name: string
  makeWorker: () => WorkerPort
  replies: Schema.Decoder<Reply>
  transferables: (request: Request) => ReadonlyArray<Transferable>
  load: Request
  close: Request
  fail: (reason: string) => E
  // A reply the session hands on itself rather than queue, as the
  // tracker's live frames: true when it took it.
  route?: (reply: Reply) => boolean
  // The Worker can say no more: it stopped, sent what it should not have,
  // or is being released.
  onStop?: () => void
}): Effect.Effect<WorkerSession<Request, Reply | Failed, E>, E, Scope.Scope> =>
  Effect.gen(function* () {
    const { name, route, onStop } = options
    const replies = yield* Queue.unbounded<Reply | Failed>()
    const decode = Schema.decodeUnknownExit(options.replies)
    const stopped = (reason: string): void => {
      onStop?.()
      Queue.offerUnsafe(replies, { _tag: 'Failed', reason })
    }
    const onMessage = (event: MessageEvent): void => {
      Exit.match(decode(event.data), {
        onSuccess: reply => {
          if (route?.(reply) !== true) {
            Queue.offerUnsafe(replies, reply)
          }
        },
        onFailure: () => stopped(`${name} sent a message it should not have.`),
      })
    }
    const onError = (event: Event): void => {
      stopped(
        event instanceof ErrorEvent && event.message !== ''
          ? `${name} stopped: ${event.message}`
          : `${name} stopped.`,
      )
    }

    const worker = yield* Effect.acquireRelease(
      Effect.try({
        try: () => {
          const created = options.makeWorker()
          created.addEventListener('message', onMessage)
          created.addEventListener('error', onError)
          created.addEventListener('messageerror', onError)
          return created
        },
        catch: error => options.fail(reasonOf(error)),
      }),
      created =>
        Effect.gen(function* () {
          onStop?.()
          created.postMessage(options.close)
          yield* Queue.take(replies).pipe(
            Effect.repeat({ until: reply => reply._tag === 'Closed' }),
            Effect.timeout(closeGrace),
            Effect.ignore,
          )
          created.removeEventListener('message', onMessage)
          created.removeEventListener('error', onError)
          created.removeEventListener('messageerror', onError)
          created.terminate()
        }),
    )

    const post = (request: Request): Effect.Effect<void> =>
      Effect.sync(() => {
        worker.postMessage(request, [...options.transferables(request)])
      })

    const reply = <A>(
      accept: (reply: Reply | Failed) => A | undefined,
    ): Effect.Effect<A, E> =>
      Effect.gen(function* () {
        const next = yield* Queue.take(replies)
        const accepted = accept(next)
        if (accepted !== undefined) {
          return accepted
        }
        return yield* Effect.fail(
          options.fail(
            next._tag === 'Failed' && 'reason' in next
              ? String(next.reason)
              : `${name} answered ${next._tag} out of turn.`,
          ),
        )
      })

    yield* post(options.load)
    yield* reply(next => (next._tag === 'Loaded' ? true : undefined))

    return { post, reply, next: Queue.take(replies) }
  })
