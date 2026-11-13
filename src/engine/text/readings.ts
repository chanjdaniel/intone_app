// A line's readings, the kana shown over its kanji (docs/readings.md):
// the tokeniser's words laid over the line's text, each with the
// dictionary's reading, the learner's corrections laid over those, and
// each word's kana split over its kanji, so the kana a word is written
// with stay bare. Readings are for the eye alone: no score reads them.

// A token as the tokeniser gives it: its surface, and its reading in
// katakana, or `*` (IPADIC's empty field) or nothing when the
// dictionary does not know the word.
export type Token = Readonly<{ surface: string; reading: string }>

// A word of the line, by its place in the text in UTF-16 code units, as
// the text is kept; its kana are in hiragana, and only a word with kanji
// has any.
export type ReadingWord = Readonly<{
  from: number
  to: number
  surface: string
  kana: string | null
}>

// The learner's reading of the word at `from` to `to`.
export type ReadingFix = Readonly<{ from: number; to: number; kana: string }>

export type FixedWord = ReadingWord & Readonly<{ fixed: boolean }>

// A stretch of a word: kanji with the kana over them, or kana, or
// anything else, bare.
export type RubyPart = Readonly<{ base: string; ruby: string | null }>

// 々 repeats the kanji before it and 〆 and ヶ are read as kanji are,
// though Unicode puts none of them in the Han script.
const kanjiPattern = /[\p{Script=Han}々〆ヶ]/u
const kanaPattern = /^[\p{Script=Hiragana}\p{Script=Katakana}ー]$/u

export const hasKanji = (text: string): boolean => kanjiPattern.test(text)

// Katakana as hiragana, ヴ and the small ヵ ヶ aside, which have none.
export const hiragana = (text: string): string =>
  text.replace(/[ァ-ヴ]/g, katakana =>
    String.fromCharCode(katakana.charCodeAt(0) - 0x60),
  )

const wordOf = (from: number, surface: string, reading: string) => ({
  from,
  to: from + surface.length,
  surface,
  kana:
    hasKanji(surface) && reading !== '' && reading !== '*'
      ? hiragana(reading)
      : null,
})

// The tokens of `text` as words that make it whole: what the tokeniser
// left out between them (a space) is a word of no reading.
export const wordsOf = (
  text: string,
  tokens: ReadonlyArray<Token>,
): ReadonlyArray<ReadingWord> => {
  const words: Array<ReadingWord> = []
  let cursor = 0
  for (const token of tokens) {
    const at = token.surface === '' ? -1 : text.indexOf(token.surface, cursor)
    if (at === -1) {
      continue
    }
    if (at > cursor) {
      words.push(wordOf(cursor, text.slice(cursor, at), ''))
    }
    words.push(wordOf(at, token.surface, token.reading))
    cursor = at + token.surface.length
  }
  if (cursor < text.length) {
    words.push(wordOf(cursor, text.slice(cursor), ''))
  }
  return words
}

// The words with the learner's corrections: each names a word by its
// place, and one that names no word, the words having moved, is left out.
export const fixedWords = (
  words: ReadonlyArray<ReadingWord>,
  fixes: ReadonlyArray<ReadingFix>,
): ReadonlyArray<FixedWord> =>
  words.map(word => {
    const fix = fixes.find(
      each => each.from === word.from && each.to === word.to,
    )
    return fix === undefined
      ? { ...word, fixed: false }
      : { ...word, kana: fix.kana, fixed: true }
  })

const runsOf = (surface: string): ReadonlyArray<string> =>
  surface.match(/[\p{Script=Han}々〆ヶ]+|[^\p{Script=Han}々〆ヶ]+/gu) ?? []

const escaped = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)

// The word's kana split over its kanji: each run of kanji takes the kana
// between the kana it is written with, matched in hiragana; a word whose
// kana do not fit around them has its kana over the whole of it.
export const rubyParts = (
  surface: string,
  kana: string | null,
): ReadonlyArray<RubyPart> => {
  if (kana === null || !hasKanji(surface)) {
    return [{ base: surface, ruby: null }]
  }
  const runs = runsOf(surface)
  const pattern = new RegExp(
    `^${runs.map(run => (hasKanji(run) ? '(.+)' : `(${escaped(hiragana(run))})`)).join('')}$`,
    'u',
  )
  const match = pattern.exec(hiragana(kana))
  if (match === null) {
    return [{ base: surface, ruby: kana }]
  }
  const parts: Array<RubyPart> = []
  let at = 0
  runs.forEach((run, k) => {
    const length = match[k + 1]?.length ?? 0
    parts.push({
      base: run,
      ruby: hasKanji(run) ? kana.slice(at, at + length) : null,
    })
    at += length
  })
  return parts
}

// A reading the learner may give a word: kana alone, and at least one.
export const isKanaReading = (draft: string): boolean =>
  draft !== '' && [...draft].every(character => kanaPattern.test(character))
