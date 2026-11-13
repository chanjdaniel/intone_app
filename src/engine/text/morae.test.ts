import { describe, expect, it } from 'vitest'

import { moraCount, moraeOf } from './morae'

describe('moraeOf', () => {
  it('counts each plain kana as a mora', () => {
    expect(moraeOf('ねこが')).toEqual(['ね', 'こ', 'が'])
    expect(moraeOf('あめがすき')).toEqual(['あ', 'め', 'が', 'す', 'き'])
  })

  it('joins a small ya, yu or yo to the kana before it', () => {
    expect(moraeOf('きょう')).toEqual(['きょ', 'う'])
    expect(moraeOf('でんしゃに')).toEqual(['で', 'ん', 'しゃ', 'に'])
    expect(moraeOf('りゅう')).toEqual(['りゅ', 'う'])
  })

  it('joins the other small vowels and small wa the same way', () => {
    expect(moraeOf('ファイル')).toEqual(['ファ', 'イ', 'ル'])
    expect(moraeOf('ティーシャツ')).toEqual(['ティ', 'ー', 'シャ', 'ツ'])
    expect(moraeOf('くゎし')).toEqual(['くゎ', 'し'])
  })

  it('counts the moraic nasal as a mora of its own', () => {
    expect(moraeOf('ほん')).toEqual(['ほ', 'ん'])
    expect(moraeOf('げんかん')).toEqual(['げ', 'ん', 'か', 'ん'])
    expect(moraeOf('コンビニ')).toEqual(['コ', 'ン', 'ビ', 'ニ'])
  })

  it('counts a geminate as a mora of its own', () => {
    expect(moraeOf('がっこうが')).toEqual(['が', 'っ', 'こ', 'う', 'が'])
    expect(moraeOf('ザッシ')).toEqual(['ザ', 'ッ', 'シ'])
    // A small tsu before a contracted kana is still its own mora.
    expect(moraeOf('ちょっと')).toEqual(['ちょ', 'っ', 'と'])
  })

  it('counts a long vowel as a mora, written with a vowel or a bar', () => {
    expect(moraeOf('おとうと')).toEqual(['お', 'と', 'う', 'と'])
    expect(moraeOf('コーヒー')).toEqual(['コ', 'ー', 'ヒ', 'ー'])
    expect(moraeOf('おかあさん')).toEqual(['お', 'か', 'あ', 'さ', 'ん'])
    expect(moraeOf('ちゅうがっこう')).toEqual([
      'ちゅ',
      'う',
      'が',
      'っ',
      'こ',
      'う',
    ])
  })

  it('leaves out spaces and punctuation between words', () => {
    expect(moraeOf('はしを わたります')).toEqual([
      'は',
      'し',
      'を',
      'わ',
      'た',
      'り',
      'ま',
      'す',
    ])
    expect(moraeOf('しずかで、いい。')).toEqual([
      'し',
      'ず',
      'か',
      'で',
      'い',
      'い',
    ])
  })

  it('refuses what is not kana, so a kanji left in a reading is found', () => {
    expect(() => moraeOf('猫が')).toThrow('猫')
    expect(() => moraeOf('neko')).toThrow('n')
  })

  it('refuses a small kana with nothing before it to join', () => {
    expect(() => moraeOf('ゃあ')).toThrow('ゃ')
  })

  it('counts them', () => {
    expect(moraCount('おとうとが')).toBe(5)
    expect(moraCount('')).toBe(0)
  })
})
