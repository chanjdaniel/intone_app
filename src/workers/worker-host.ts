import { Effect, Queue, Stream } from 'effect'

// A Worker program's side of the project's own protocol (AGENTS.md,
// "Effect"): the page's messages as they come, and a reply posted with
// the arrays it carries transferred.

// Every message the page sends, in order, until the Worker closes.
export const incoming: Stream.Stream<unknown> = Stream.callback<unknown>(
  queue =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const listener = (event: MessageEvent): void => {
          Queue.offerUnsafe(queue, event.data)
        }
        self.addEventListener('message', listener)
        return listener
      }),
      listener =>
        Effect.sync(() => {
          self.removeEventListener('message', listener)
        }),
    ),
)

// Posts a reply to the page, transferring the arrays `transferables`
// names in it.
export const poster =
  <Reply>(transferables: (reply: Reply) => ReadonlyArray<Transferable>) =>
  (reply: Reply): Effect.Effect<void> =>
    Effect.sync(() => {
      self.postMessage(reply, { transfer: [...transferables(reply)] })
    })
