import { Schema } from 'effect'

// The readings Worker's protocol (./readings.worker.ts): one Schema per
// message kind, decoded at the boundary once per message. Only text
// travels, so nothing is transferred.

// The size of Lindera's WebAssembly, which the Worker loads beside its
// module: with the dictionary's zip, what turning readings on first
// downloads. tests/readings/lindera.test.ts checks it against the
// installed package.
export const linderaWasmBytes = 1_784_285

// TO THE WORKER

export const Load = Schema.TaggedStruct('Load', {
  // The dictionary's zip on the app's own origin, and its size from
  // models.json, which the download must match.
  dictionary: Schema.String,
  bytes: Schema.Finite,
})

// The texts to read, each one line's: answered by `Tokens`.
export const Read = Schema.TaggedStruct('Read', {
  texts: Schema.Array(Schema.String),
})

// Free the dictionary and close.
export const Close = Schema.TaggedStruct('Close', {})

export const ToReadings = Schema.Union([Load, Read, Close])
export type ToReadings = typeof ToReadings.Type

// FROM THE WORKER

export const Loaded = Schema.TaggedStruct('Loaded', {})

// A token's surface, and its reading in katakana as IPADIC gives it, `*`
// when the dictionary does not know the word (../engine/text/readings.ts).
export const Token = Schema.Struct({
  surface: Schema.String,
  reading: Schema.String,
})

// Each text's tokens, in the order the texts were sent.
export const Tokens = Schema.TaggedStruct('Tokens', {
  texts: Schema.Array(Schema.Array(Token)),
})

export const Failed = Schema.TaggedStruct('Failed', { reason: Schema.String })

// The Worker has freed the dictionary and is about to close itself.
export const Closed = Schema.TaggedStruct('Closed', {})

export const FromReadings = Schema.Union([Loaded, Tokens, Failed, Closed])
export type FromReadings = typeof FromReadings.Type
