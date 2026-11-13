import { describe, expect, test } from 'vitest'

import { lineTextsOf, matchPieces, trimmedLineText } from './match'
import { type Vocabulary, piecesOf } from './pieces'
import { longestWindowSeconds, textWindows } from './windows'

// The text of an uploaded clip: Whisper's windows over it, the pieces of
// text its tokens make, each with its time, and those pieces matched to
// the clip's lines by time.

describe('the windows Whisper reads', () => {
  test('covers a short clip in one window, from just before its first line to just after its last', () => {
    expect(
      textWindows(
        [
          { from: 1, to: 3 },
          { from: 4, to: 7 },
        ],
        10,
      ),
    ).toStrictEqual([{ from: 0.8, to: 7.2 }])
  })

  test('keeps to the clip', () => {
    expect(textWindows([{ from: 0.1, to: 9.95 }], 10)).toStrictEqual([
      { from: 0, to: 10 },
    ])
  })

  test('closes each window in a pause between two lines, never inside a line, and never longer than Whisper reads', () => {
    const lines = Array.from({ length: 30 }, (_, k) => ({
      from: k * 3 + 0.5,
      to: k * 3 + 2.5,
    }))
    const windows = textWindows(lines, 92)

    expect(windows.length).toBeGreaterThan(2)
    for (const window of windows) {
      expect(window.to - window.from).toBeLessThanOrEqual(longestWindowSeconds)
    }
    for (const [before, after] of windows
      .slice(1)
      .map((window, k) => [windows[k], window] as const)) {
      expect(after.from).toBe(before?.to)
      for (const line of lines) {
        expect(after.from <= line.from || after.from >= line.to).toBe(true)
      }
    }
    expect(windows[0]?.from).toBeCloseTo(0.3)
    expect(windows.at(-1)?.to).toBeCloseTo(89.7)
  })

  test('cuts a line longer than a window into whole windows', () => {
    const windows = textWindows([{ from: 0, to: 70 }], 70)

    expect(windows).toStrictEqual([
      { from: 0, to: 30 },
      { from: 30, to: 60 },
      { from: 60, to: 70 },
    ])
  })

  test('reads nothing of a clip with no lines', () => {
    expect(textWindows([], 30)).toStrictEqual([])
  })
})

// A vocabulary like Whisper's: ids at and above 100 are timestamps, 0.02 s
// apart; 1 to 3 are special; a character split over two byte tokens
// decodes to the replacement character until both are there.
const vocabulary: Vocabulary = {
  timestampBegin: 100,
  secondsPerTimestamp: 0.02,
  isSpecial: id => id >= 1 && id <= 3,
  decode: ids => {
    const text = ids
      .map(id =>
        id === 50 ? '�' : id === 51 ? '昔' : String.fromCodePoint(id + 12_300),
      )
      .join('')
    return text.replace('�昔', '昔')
  },
}

describe('the pieces of text a window gives', () => {
  test('is one piece per decodable run of tokens, each from its token time to the next, offset by the window', () => {
    // <|startoftranscript|> <|ja|> <|transcribe|> <0.00> 昔(2 tokens) は の <1.00>
    const tokens = [1, 2, 3, 100, 50, 51, 53, 54, 150]
    const times = [0, 0, 0, 0, 0.1, 0.2, 0.4, 0.6, 1.9]
    const pieces = piecesOf(tokens, times, vocabulary, 10)

    expect(pieces).toStrictEqual([
      { text: '昔', from: 10.1, to: 10.4 },
      { text: vocabulary.decode([53]), from: 10.4, to: 10.6 },
      { text: vocabulary.decode([54]), from: 10.6, to: 11 },
    ])
  })

  test('ends a piece at the most a token lasts, so a pause after it is not counted as its', () => {
    const tokens = [100, 53, 54, 200]
    const times = [0, 0.5, 3, 0]
    const pieces = piecesOf(tokens, times, vocabulary, 0)

    expect(pieces[0]).toStrictEqual({
      text: vocabulary.decode([53]),
      from: 0.5,
      to: 1.1,
    })
    expect(pieces[1]?.to).toBe(2)
    expect(pieces[1]?.from).toBe(2)
  })

  test('gives no piece of a window with no text', () => {
    expect(
      piecesOf([1, 2, 3, 100, 101], [0, 0, 0, 0, 0], vocabulary, 0),
    ).toStrictEqual([])
  })
})

const piece = (text: string, from: number, to = from + 0.2) => ({
  text,
  from,
  to,
})

describe('matching the pieces to the lines', () => {
  const lines = [
    { from: 1, to: 3 },
    { from: 4, to: 6 },
    { from: 8, to: 9 },
  ]

  test('puts each piece on the line its middle falls in, in order, and says which', () => {
    const pieces = [
      piece('雨', 1.1),
      piece('が', 1.5),
      piece('、', 3.9),
      piece('好', 4.2),
      piece('き', 5.7),
      piece('晴', 8.4),
    ]

    expect(lineTextsOf(pieces, lines)).toStrictEqual(['雨が', '好き', '晴'])
    expect(matchPieces(pieces, lines)).toStrictEqual([0, 0, 1, 1, 1, 2])
  })

  test('puts a piece in a pause on the nearer line within half a second, and leaves out one further than that', () => {
    const pieces = [piece('前', 3.2), piece('後', 3.65), piece('間', 6.8)]

    expect(matchPieces(pieces, lines)).toStrictEqual([0, 1, null])
    expect(lineTextsOf(pieces, lines)).toStrictEqual(['前', '後', ''])
  })

  test('starts a line at its first word, without the punctuation that closed the line before', () => {
    expect(trimmedLineText(['、', '中', '山', '様', '。'])).toBe('中山様。')
    expect(trimmedLineText([' 。', ' ', '雨'])).toBe('雨')
    expect(trimmedLineText(['雨', ' '])).toBe('雨')
  })

  test('drops the spaces Whisper puts between Japanese words, and keeps those between other words', () => {
    expect(trimmedLineText(['様が', ' 怒', 'られた'])).toBe('様が怒られた')
    expect(trimmedLineText(['ゴン', ' ・', ' ギツネ'])).toBe('ゴン・ギツネ')
    expect(trimmedLineText(['good', ' bye', '、', ' 雨'])).toBe('good bye、雨')
  })

  test('gives each line the empty text when nothing was said in it', () => {
    expect(lineTextsOf([], lines)).toStrictEqual(['', '', ''])
  })
})
