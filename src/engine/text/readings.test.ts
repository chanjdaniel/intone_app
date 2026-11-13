import { describe, expect, test } from 'vitest'

import { fixedWords, isKanaReading, rubyParts, wordsOf } from './readings'

// A line's readings: the tokeniser's words laid over the text, the
// learner's corrections over those, and each word's kana split over its
// kanji, the kana it is written with left bare.

describe("the tokeniser's words over a line's text", () => {
  test('gives each word its place in the text, and kana, in hiragana, only to a word with kanji', () => {
    expect(
      wordsOf('雨が好き', [
        { surface: '雨', reading: 'アメ' },
        { surface: 'が', reading: 'ガ' },
        { surface: '好き', reading: 'スキ' },
      ]),
    ).toStrictEqual([
      { from: 0, to: 1, surface: '雨', kana: 'あめ' },
      { from: 1, to: 2, surface: 'が', kana: null },
      { from: 2, to: 4, surface: '好き', kana: 'すき' },
    ])
  })

  test('keeps what the tokeniser left out, as spaces, as words of no reading, so the words make the whole text', () => {
    const words = wordsOf('中山 さま', [
      { surface: '中山', reading: 'ナカヤマ' },
      { surface: 'さま', reading: 'サマ' },
    ])

    expect(words.map(word => word.surface).join('')).toBe('中山 さま')
    expect(words[1]).toStrictEqual({
      from: 2,
      to: 3,
      surface: ' ',
      kana: null,
    })
  })

  test('gives a word the dictionary does not know no reading, so the learner can give it one', () => {
    expect(wordsOf('聴史', [{ surface: '聴史', reading: '*' }])).toStrictEqual([
      { from: 0, to: 2, surface: '聴史', kana: null },
    ])
  })

  test('counts places in UTF-16, as the text is kept, past a character outside the basic plane', () => {
    expect(
      wordsOf('𠮷野', [
        { surface: '𠮷', reading: '' },
        { surface: '野', reading: 'ノ' },
      ]),
    ).toStrictEqual([
      { from: 0, to: 2, surface: '𠮷', kana: null },
      { from: 2, to: 3, surface: '野', kana: 'の' },
    ])
  })
})

describe("the learner's corrections", () => {
  const words = wordsOf('二人の男', [
    { surface: '二', reading: 'ニ' },
    { surface: '人', reading: 'ニン' },
    { surface: 'の', reading: 'ノ' },
    { surface: '男', reading: 'オトコ' },
  ])

  test("replace the dictionary's reading of the word they name, by its place", () => {
    const fixed = fixedWords(words, [{ from: 1, to: 2, kana: 'り' }])

    expect(
      fixed.map(word => [word.surface, word.kana, word.fixed]),
    ).toStrictEqual([
      ['二', 'に', false],
      ['人', 'り', true],
      ['の', null, false],
      ['男', 'おとこ', false],
    ])
  })

  test('name no word once the words have moved, and are then left out', () => {
    const fixed = fixedWords(words, [{ from: 0, to: 2, kana: 'ふたり' }])

    expect(fixed.some(word => word.fixed)).toBe(false)
  })
})

describe("a word's kana over its kanji", () => {
  test('stands over the kanji alone, the kana written after them left bare', () => {
    expect(rubyParts('好き', 'すき')).toStrictEqual([
      { base: '好', ruby: 'す' },
      { base: 'き', ruby: null },
    ])
  })

  test('stands over each run of kanji, the kana between them left bare', () => {
    expect(rubyParts('引き出し', 'ひきだし')).toStrictEqual([
      { base: '引', ruby: 'ひ' },
      { base: 'き', ruby: null },
      { base: '出', ruby: 'だ' },
      { base: 'し', ruby: null },
    ])
  })

  test('leaves the kana before the kanji bare, and katakana too', () => {
    expect(rubyParts('お前', 'おまえ')).toStrictEqual([
      { base: 'お', ruby: null },
      { base: '前', ruby: 'まえ' },
    ])
    expect(rubyParts('ロイド眼鏡', 'ろいどめがね')).toStrictEqual([
      { base: 'ロイド', ruby: null },
      { base: '眼鏡', ruby: 'めがね' },
    ])
  })

  test('stands over the whole word when its kana do not fit around the kanji', () => {
    expect(rubyParts('明日', 'あした')).toStrictEqual([
      { base: '明日', ruby: 'あした' },
    ])
    expect(rubyParts('好き', 'すく')).toStrictEqual([
      { base: '好き', ruby: 'すく' },
    ])
  })

  test('is the word bare when it has no kanji or no reading', () => {
    expect(rubyParts('ゴン', null)).toStrictEqual([
      { base: 'ゴン', ruby: null },
    ])
    expect(rubyParts('聴史', null)).toStrictEqual([
      { base: '聴史', ruby: null },
    ])
  })

  test('keeps the kana as the learner wrote them, katakana included', () => {
    expect(rubyParts('入江', 'イリエ')).toStrictEqual([
      { base: '入江', ruby: 'イリエ' },
    ])
  })
})

describe('a reading the learner writes', () => {
  test.each(['いりえ', 'イリエ', 'こーひー', 'ヴァ'])('takes %s', draft => {
    expect(isKanaReading(draft)).toBe(true)
  })

  test.each(['', ' ', '入江', 'irie', 'い り え'])('refuses %j', draft => {
    expect(isKanaReading(draft)).toBe(false)
  })
})
