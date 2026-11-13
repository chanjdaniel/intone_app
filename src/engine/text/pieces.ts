// The pieces of text Whisper's tokens make, each with its time. Whisper
// reads one window (./windows.ts) and gives its tokens with the time each
// starts, from its cross-attention; a token is often part of a Japanese
// character, so a piece is the shortest run of tokens that decodes whole.
// A piece lasts until the next one starts, but no longer than a token
// says, so a pause after it is not counted as its; and no later than the
// timestamp that ends its segment.
//
// Transformers.js 4.3.2 groups a Japanese transcript's word timestamps
// on spaces, as for English, since it drops the language token before it
// groups them, so its "words" are whole phrases of up to 7 s, longer than
// a line; the text Worker reads the tokens itself and makes pieces here
// (docs/transcription.md).

export type TextPiece = Readonly<{ text: string; from: number; to: number }>

// What the pieces need of a Whisper tokenizer.
export type Vocabulary = Readonly<{
  // The first timestamp token's id; each one after it is a step later.
  timestampBegin: number
  secondsPerTimestamp: number
  isSpecial: (id: number) => boolean
  decode: (ids: ReadonlyArray<number>) => string
}>

// The longest a piece is taken to last: two or three morae, which no one
// token of Whisper's holds more than.
export const longestPieceSeconds = 0.6

const unfinished = '�'

const rounded = (seconds: number): number => Math.round(seconds * 1000) / 1000

export const piecesOf = (
  tokens: ReadonlyArray<number>,
  times: ReadonlyArray<number>,
  vocabulary: Vocabulary,
  offsetSeconds: number,
): ReadonlyArray<TextPiece> => {
  const pieces: Array<{ text: string; from: number; to: number | null }> = []
  const pending: Array<number> = []
  const state = { pendingFrom: 0 }
  const endOpen = (at: number): void => {
    const open = pieces.at(-1)
    if (open !== undefined && open.to === null) {
      open.from = Math.min(open.from, at)
      open.to = Math.min(at, open.from + longestPieceSeconds)
    }
  }
  tokens.forEach((id, k) => {
    if (id >= vocabulary.timestampBegin) {
      if (pieces.length > 0) {
        endOpen(
          offsetSeconds +
            (id - vocabulary.timestampBegin) * vocabulary.secondsPerTimestamp,
        )
      }
      pending.length = 0
      return
    }
    if (vocabulary.isSpecial(id)) {
      return
    }
    if (pending.length === 0) {
      state.pendingFrom = offsetSeconds + (times[k] ?? 0)
    }
    pending.push(id)
    const text = vocabulary.decode(pending)
    if (text.includes(unfinished)) {
      return
    }
    endOpen(state.pendingFrom)
    pieces.push({ text, from: state.pendingFrom, to: null })
    pending.length = 0
  })
  const last = pieces.at(-1)
  if (last !== undefined && last.to === null) {
    last.to = last.from + longestPieceSeconds
  }
  return pieces.map(({ text, from, to }) => ({
    text,
    from: rounded(from),
    to: rounded(to ?? from),
  }))
}
