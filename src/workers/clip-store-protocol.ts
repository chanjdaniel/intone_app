import { Schema } from 'effect'

// The clip store Worker's protocol (../services/clip-store.ts): one file
// to write in, one answer out, its bytes transferred, never copied.

const Bytes = Schema.instanceOf(Uint8Array<ArrayBufferLike>)

export const Write = Schema.TaggedStruct('Write', {
  // Folders and the file's name, from the origin private file system's
  // root, such as `takes/abc.wav`.
  path: Schema.Array(Schema.String),
  bytes: Bytes,
})
export type Write = typeof Write.Type

export const Written = Schema.TaggedStruct('Written', {})

export const WriteFailed = Schema.TaggedStruct('WriteFailed', {
  reason: Schema.String,
})

export const FromClipStore = Schema.Union([Written, WriteFailed])
export type FromClipStore = typeof FromClipStore.Type
