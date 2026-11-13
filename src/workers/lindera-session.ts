import { Effect, Schema, type Scope } from 'effect'
import { unzipSync } from 'fflate'
import initLindera, {
  type InitInput,
  TokenizerBuilder,
  loadDictionaryFromBytes,
} from 'lindera-wasm'

import { reasonOf } from '../engine/reason'
import type { Token } from '../engine/text/readings'

// The tokeniser that gives a line's words their readings: Lindera's
// WebAssembly with the IPADIC dictionary it builds, read from the zip of
// its release (models.json, `lindera-ipadic`), in a scope that frees
// both on close. docs/readings.md says why Lindera and IPADIC.

export class TokeniserError extends Schema.TaggedError<
  TokeniserError,
  { readonly brand: unique symbol }
>()('TokeniserError', { reason: Schema.String }) {}

// The files of a Lindera dictionary, which `loadDictionaryFromBytes`
// takes; the zip holds them in one folder, with its NOTICE.txt.
const dictionaryFiles = [
  'metadata.json',
  'dict.trie',
  'dict.valsidx',
  'dict.vals',
  'dict.wordsidx',
  'dict.words',
  'matrix.mtx',
  'char_def.bin',
  'unk.bin',
] as const

// Where IPADIC's reading is among a token's details: after the part of
// speech and its three subcategories, the conjugation's form and type,
// and the base form (the zip's metadata.json, `dictionary_schema`, less
// the surface, the two context ids and the cost).
const readingDetail = 7

const LinderaToken = Schema.Struct({
  surface: Schema.String,
  details: Schema.Array(Schema.String),
})
const decodeTokens = Schema.decodeUnknownSync(Schema.Array(LinderaToken))

export type TokeniserSession = Readonly<{
  tokenise: (
    text: string,
  ) => Effect.Effect<ReadonlyArray<Token>, TokeniserError>
}>

const failed = (lead: string) => (error: unknown) =>
  new TokeniserError({ reason: `${lead}: ${reasonOf(error)}` })

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

// The dictionary's files from its zip, by name.
const unzipped = (zip: Uint8Array): ReadonlyMap<string, Uint8Array> => {
  const wanted = new Set<string>(dictionaryFiles)
  const files = unzipSync(zip, {
    filter: file => wanted.has(nameOf(file.name)),
  })
  return new Map(
    Object.entries(files).map(([path, bytes]) => [nameOf(path), bytes]),
  )
}

// The tokeniser, from the dictionary's zip; `wasm` is where Lindera's
// WebAssembly is, by default beside its module, as the bundler emits it.
export const openTokeniser = (
  zip: Uint8Array,
  wasm?: InitInput,
): Effect.Effect<TokeniserSession, TokeniserError, Scope.Scope> =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () =>
        initLindera(wasm === undefined ? undefined : { module_or_path: wasm }),
      catch: failed('Lindera did not start'),
    })
    const tokenizer = yield* Effect.acquireRelease(
      Effect.try({
        try: () => {
          const files = unzipped(zip)
          const file = (name: (typeof dictionaryFiles)[number]) => {
            const bytes = files.get(name)
            if (bytes === undefined) {
              throw new Error(`the zip holds no ${name}`)
            }
            return bytes
          }
          const dictionary = loadDictionaryFromBytes(
            file('metadata.json'),
            file('dict.trie'),
            file('dict.valsidx'),
            file('dict.vals'),
            file('dict.wordsidx'),
            file('dict.words'),
            file('matrix.mtx'),
            file('char_def.bin'),
            file('unk.bin'),
          )
          // The builder takes the dictionary over, and the tokeniser it
          // builds shares it, so the dictionary is freed with the
          // tokeniser; the Worker's closing frees the rest of its memory.
          const builder = new TokenizerBuilder()
          builder.setDictionaryInstance(dictionary)
          builder.setMode('normal')
          const built = builder.build()
          builder.free()
          return built
        },
        catch: failed('The reading dictionary did not load'),
      }),
      built =>
        Effect.sync(() => {
          built.free()
        }),
    )
    return {
      tokenise: text =>
        Effect.try({
          try: () =>
            decodeTokens(tokenizer.tokenize(text)).map(token => ({
              surface: token.surface,
              reading: token.details[readingDetail] ?? '',
            })),
          catch: failed('The text could not be read'),
        }),
    }
  })
