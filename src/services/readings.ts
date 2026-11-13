import { Context, Effect, Layer, Schema, type Scope } from 'effect'
import { modelFiles, modelUrls } from 'virtual:intone/models'

import { type ReadingWord, type Token, wordsOf } from '../engine/text/readings'
import {
  FromReadings,
  type ToReadings,
  linderaWasmBytes,
} from '../workers/readings-protocol'
import { type WorkerPort, openWorkerSession } from './worker-session'

// The readings of a line's text, the kana shown over its kanji, from the
// tokeniser in the readings Worker (../workers/readings.worker.ts): opened
// in a scope, which downloads the dictionary the first time and holds it
// unpacked, then asked for the words of each text, each with the
// dictionary's reading. Closing the scope frees the dictionary. Readings
// are display only: no score reads them. Nothing here leaves the device;
// the only requests are for the dictionary and the tokeniser, on the
// app's own origin.

const dictionaryBytes = modelFiles['lindera-ipadic'].reduce(
  (sum, file) => sum + file.bytes,
  0,
)

// What turning readings on first downloads, in bytes: the dictionary's
// zip, from models.json, and Lindera's WebAssembly.
export const readingsDownloadBytes = dictionaryBytes + linderaWasmBytes

export class ReadingsError extends Schema.TaggedError<
  ReadingsError,
  { readonly brand: unique symbol }
>()('ReadingsError', { reason: Schema.String }) {}

export type ReadingsSession = Readonly<{
  // Each text's words, in the order of the texts.
  read: (
    texts: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<ReadonlyArray<ReadingWord>>, ReadingsError>
}>

export type ReadingsBrowser = Readonly<{
  makeWorker: () => WorkerPort
  dictionary: Readonly<{ url: string; bytes: number }>
}>

const failed = (reason: string) => new ReadingsError({ reason })

export const openReadingsWith = (
  browser: ReadingsBrowser,
): Effect.Effect<ReadingsSession, ReadingsError, Scope.Scope> =>
  Effect.gen(function* () {
    const worker = yield* openWorkerSession({
      name: 'The readings',
      makeWorker: browser.makeWorker,
      replies: FromReadings,
      transferables: (_request: ToReadings) => [],
      load: {
        _tag: 'Load',
        dictionary: browser.dictionary.url,
        bytes: browser.dictionary.bytes,
      },
      close: { _tag: 'Close' },
      fail: failed,
    })
    return {
      read: texts =>
        worker.post({ _tag: 'Read', texts }).pipe(
          Effect.andThen(
            worker.reply(reply =>
              reply._tag === 'Tokens' ? reply.texts : undefined,
            ),
          ),
          Effect.map(tokens =>
            texts.map((text, k) => wordsOf(text, tokens[k] ?? [])),
          ),
        ),
    }
  })

export class Readings extends Context.Service<
  Readings,
  {
    // The tokeniser with its dictionary loaded, until the scope closes.
    readonly open: Effect.Effect<ReadingsSession, ReadingsError, Scope.Scope>
  }
>()('intone/services/Readings') {
  static readonly layer = Layer.sync(Readings, () =>
    Readings.of({
      open: openReadingsWith({
        makeWorker: () =>
          new Worker(
            new URL('../workers/readings.worker.ts', import.meta.url),
            {
              type: 'module',
              name: 'readings',
            },
          ),
        dictionary: {
          url: modelUrls['lindera-ipadic'],
          bytes: dictionaryBytes,
        },
      }),
    }),
  )

  // Reads each text with the tokens `tokens` gives it, with no Worker or
  // dictionary; `open` fails with `error` when one is given.
  static readonly layerTest = (
    tokens: (text: string) => ReadonlyArray<Token>,
    error?: ReadingsError,
  ): Layer.Layer<Readings> =>
    Layer.succeed(
      Readings,
      Readings.of({
        open:
          error === undefined
            ? Effect.succeed({
                read: texts =>
                  Effect.succeed(
                    texts.map(text => wordsOf(text, tokens(text))),
                  ),
              })
            : Effect.fail(error),
      }),
    )
}
