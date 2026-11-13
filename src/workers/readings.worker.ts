import { Effect, Exit, Match, Schema, Scope, Stream } from 'effect'

import { reasonOf } from '../engine/reason'
import { type TokeniserSession, openTokeniser } from './lindera-session'
import { type FromReadings, ToReadings } from './readings-protocol'
import { incoming, poster } from './worker-host'

// The readings Worker: a line's text in, its tokens with their readings
// out. On `Load` it fetches the dictionary's zip from the app's own origin
// (the browser's cache keeps it, as the build's caching table says) and
// opens the tokeniser in a scope (./lindera-session.ts); a `Close` frees
// the dictionary, says `Closed` and closes the Worker, so the 50 MB it
// takes unpacked is held only while readings are shown. Nothing here
// leaves the device: the only requests are for the dictionary and
// Lindera's WebAssembly, on the app's own origin.

const post = poster<FromReadings>(() => [])

const fetchedZip = (url: string, bytes: number) =>
  Effect.tryPromise({
    try: async signal => {
      const response = await fetch(url, { signal })
      if (!response.ok) {
        throw new Error(`${url} answered ${response.status}.`)
      }
      const zip = new Uint8Array(await response.arrayBuffer())
      if (zip.length !== bytes) {
        throw new Error(
          `${url} gave ${zip.length} bytes, where ${bytes} were listed.`,
        )
      }
      return zip
    },
    catch: error =>
      ({
        reason: `The reading dictionary could not be downloaded: ${reasonOf(error)}`,
      }) as const,
  })

const program = Effect.gen(function* () {
  const scope = yield* Scope.make()
  const state: { session: TokeniserSession | null } = { session: null }

  const handle = (message: ToReadings): Effect.Effect<void> =>
    Match.value(message).pipe(
      Match.tagsExhaustive({
        Load: ({ dictionary, bytes }) =>
          fetchedZip(dictionary, bytes).pipe(
            Effect.flatMap(zip => Scope.provide(openTokeniser(zip), scope)),
            Effect.flatMap(session =>
              Effect.sync(() => {
                state.session = session
              }),
            ),
            Effect.andThen(post({ _tag: 'Loaded' })),
            Effect.catch(error =>
              post({ _tag: 'Failed', reason: error.reason }),
            ),
          ),
        Read: ({ texts }) => {
          const session = state.session
          return session === null
            ? post({
                _tag: 'Failed',
                reason: 'The readings Worker is not loaded.',
              })
            : Effect.forEach(texts, text => session.tokenise(text)).pipe(
                Effect.flatMap(tokens =>
                  post({ _tag: 'Tokens', texts: tokens }),
                ),
                Effect.catch(error =>
                  post({ _tag: 'Failed', reason: error.reason }),
                ),
              )
        },
        Close: () => Effect.void,
      }),
    )

  yield* incoming.pipe(
    Stream.mapEffect(data =>
      Schema.decodeUnknownEffect(ToReadings)(data).pipe(
        Effect.tap(handle),
        Effect.catchTag('SchemaError', error =>
          post({ _tag: 'Failed', reason: error.message }).pipe(Effect.as(null)),
        ),
      ),
    ),
    Stream.takeUntil(message => message?._tag === 'Close'),
    Stream.runDrain,
  )

  yield* Scope.close(scope, Exit.void)
  yield* post({ _tag: 'Closed' })
  self.close()
})

Effect.runFork(Effect.scoped(program))
