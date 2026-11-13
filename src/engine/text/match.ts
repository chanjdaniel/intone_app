import type { TextPiece } from './pieces'
import type { Span } from './windows'

// A clip's transcript matched to its lines by time: each piece of text
// (./pieces.ts) goes to the line its middle falls in, or, in a pause, to
// the nearer line within half a second, since Whisper's times run a
// little early or late; further from any line, it is left out. A line's
// text is its pieces in order, without the punctuation that closed the
// line before it. Matching runs each time a line's text is shown, so a
// line the learner moved, split or merged gets the words of its new span.

// How far outside a line a piece may start and still be its.
export const pieceReachSeconds = 0.5

const middleOf = (piece: TextPiece): number => (piece.from + piece.to) / 2

const distanceTo = (seconds: number, line: Span): number =>
  seconds < line.from
    ? line.from - seconds
    : seconds >= line.to
      ? seconds - line.to
      : 0

// Each piece's line, by its place in `lines`, or null.
export const matchPieces = (
  pieces: ReadonlyArray<TextPiece>,
  lines: ReadonlyArray<Span>,
): ReadonlyArray<number | null> =>
  pieces.map(piece => {
    const middle = middleOf(piece)
    const nearest = lines.reduce<{ line: number | null; distance: number }>(
      (best, line, k) => {
        const distance = distanceTo(middle, line)
        return distance < best.distance ? { line: k, distance } : best
      },
      { line: null, distance: Number.POSITIVE_INFINITY },
    )
    return nearest.distance <= pieceReachSeconds ? nearest.line : null
  })

const openingPunctuation = /^[\s　、。，．,.!?！？]+/

// Kana, kanji and Japanese punctuation, between which Japanese puts no
// space, though Whisper's tokens often begin with one.
const japanese = String.raw`\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}　-〿・ー！-／`
const spaceNextToJapanese = new RegExp(
  String.raw`(?<=[${japanese}])\s+|\s+(?=[${japanese}])`,
  'gu',
)

export const trimmedLineText = (texts: ReadonlyArray<string>): string =>
  texts
    .join('')
    .replace(spaceNextToJapanese, '')
    .replace(openingPunctuation, '')
    .trim()

// Each line's text, in the order of `lines`.
export const lineTextsOf = (
  pieces: ReadonlyArray<TextPiece>,
  lines: ReadonlyArray<Span>,
): ReadonlyArray<string> => {
  const matched = matchPieces(pieces, lines)
  return lines.map((_, k) =>
    trimmedLineText(
      pieces.filter((_, p) => matched[p] === k).map(piece => piece.text),
    ),
  )
}
