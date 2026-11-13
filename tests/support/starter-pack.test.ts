import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { decodeWav } from '../../src/engine/audio/wav.ts'
import type {
  StarterList,
  StarterListLine,
  StarterWord,
} from '../../src/services/starter-records.ts'
import {
  applyReview,
  convertRecording,
  creditOf,
  lineFlag,
  listProblems,
  packSampleRate,
  recipeOf,
  unidicAccents,
  unidicFeatures,
  voicevoxKana,
  wiktionaryAccents,
  wordFlag,
} from './starter-pack.ts'

const word = (
  fields: Partial<StarterWord> &
    Pick<StarterWord, 'text' | 'kana' | 'accentType'>,
): StarterWord => fields

describe('voicevoxKana', () => {
  it('marks the fall after the accent mora, and a heiban word after its particle', () => {
    expect(
      voicevoxKana([
        word({ text: '猫', kana: 'ねこ', accentType: 1, particle: 'が' }),
      ]),
    ).toBe("ネ'コガ")
    expect(
      voicevoxKana([
        word({ text: '弟', kana: 'おとうと', accentType: 4, particle: 'が' }),
      ]),
    ).toBe("オトオト'ガ")
    expect(
      voicevoxKana([
        word({ text: '学校', kana: 'がっこう', accentType: 0, particle: 'が' }),
      ]),
    ).toBe("ガッコオガ'")
  })

  it('writes long vowels as said, since the notation has no bar', () => {
    expect(
      voicevoxKana([
        word({ text: '先生', kana: 'せんせい', accentType: 3, particle: 'が' }),
      ]),
    ).toBe("センセ'エガ")
    expect(
      voicevoxKana([
        word({
          text: 'コーヒー',
          kana: 'コーヒー',
          accentType: 3,
          particle: 'を',
        }),
      ]),
    ).toBe("コオヒ'イオ")
  })

  it('puts each word in an accent phrase of its own', () => {
    expect(
      voicevoxKana([
        word({ text: '雨', kana: 'あめ', accentType: 1, particle: 'が' }),
        word({ text: '好き', kana: 'すき', accentType: 2 }),
      ]),
    ).toBe("ア'メガ/スキ'")
  })
})

describe('wiktionaryAccents', () => {
  const page = (pron: string) =>
    `==English==\n{{ja-pron|はし|acc=3}}\n==Japanese==\n===Etymology 1===\n${pron}\n==Korean==\n{{ja-pron|はし|acc=4}}\n`

  it('reads the Japanese section only, by its reading', () => {
    expect(
      wiktionaryAccents(page('{{ja-pron|はし|acc=2|acc_ref=NHK}}'), 'はし'),
    ).toEqual([2])
    expect(wiktionaryAccents(page('{{ja-pron|はな|acc=2}}'), 'はし')).toEqual(
      [],
    )
  })

  it('reads the letters for heiban, atamadaka and odaka', () => {
    expect(wiktionaryAccents(page('{{ja-pron|はし|acc=h}}'), 'はし')).toEqual([
      0,
    ])
    expect(wiktionaryAccents(page('{{ja-pron|はし|acc=a}}'), 'はし')).toEqual([
      1,
    ])
    expect(wiktionaryAccents(page('{{ja-pron|はし|acc=o}}'), 'はし')).toEqual([
      2,
    ])
    expect(wiktionaryAccents(page('{{ja-pron|はし|acc=n}}'), 'はし')).toEqual(
      [],
    )
  })

  it('keeps every accent but one given for a place, and reads through references', () => {
    expect(
      wiktionaryAccents(
        page(
          '{{ja-pron|おんがく|acc=1|acc_ref=<ref name="x">{{R:NHK|a|b}}</ref>|acc2=0|acc3=2|acc3_loc=Osaka}}',
        ),
        'おんがく',
      ),
    ).toEqual([1, 0])
  })

  it('counts a template with no reading, and a reading written with dots', () => {
    expect(
      wiktionaryAccents(page('{{ja-pron|acc=3|acc_ref=NHK}}'), 'コーヒー'),
    ).toEqual([3])
    expect(
      wiktionaryAccents(page('{{ja-pron|acc=3|みず.うみ}}'), 'みずうみ'),
    ).toEqual([3])
  })
})

describe('UniDic', () => {
  // A dictionary of three entries, laid out as MeCab compiles one: the
  // header, an empty double array and token table, then the features.
  const dictionary = (features: ReadonlyArray<string>): Uint8Array => {
    const text = new TextEncoder().encode(features.join('\0') + '\0')
    const bytes = new Uint8Array(72 + text.length)
    new DataView(bytes.buffer).setUint32(32, text.length, true)
    bytes.set(text, 72)
    return bytes
  }
  const entry = (
    pos2: string,
    orth: string,
    kana: string,
    aType: string,
    iForm = '*',
  ) =>
    `名詞,${pos2},一般,*,*,*,${kana},${orth},${orth},${kana},${orth},${kana},和,*,${iForm},*,*,*,*,体,${kana},${kana},${kana},${kana},${aType},C1,*,1,1`
  const features = unidicFeatures(
    dictionary([
      entry('普通名詞', '昨日', 'キノウ', '"2,0"'),
      entry('固有名詞', '橋', 'ハシ', '1'),
      entry('普通名詞', '橋', 'ハシ', '2'),
      entry('普通名詞', '雲', 'グモ', '1', '濁音形'),
    ]),
  )

  it('gives every accent type of a base entry, in its order', () => {
    expect(unidicAccents(features, '昨日', 'きのう')).toEqual([2, 0])
  })

  it('leaves out proper names, other readings and sound-changed forms', () => {
    expect(unidicAccents(features, '橋', 'はし')).toEqual([2])
    expect(unidicAccents(features, '雲', 'ぐも')).toEqual([])
    expect(unidicAccents(features, '花', 'はな')).toEqual([])
  })
})

describe('flags', () => {
  it('says nothing when both sources give the stated type alone', () => {
    expect(
      wordFlag(
        word({
          text: '猫',
          kana: 'ねこ',
          accentType: 1,
          unidic: [1],
          wiktionary: [1],
        }),
      ),
    ).toBeUndefined()
  })

  it('names what each source gives when they give more, or another, or none', () => {
    expect(
      wordFlag(
        word({
          text: '昨日',
          kana: 'きのう',
          accentType: 2,
          unidic: [2, 0],
          wiktionary: [2],
        }),
      ),
    ).toBe(
      '昨日 (きのう): UniDic gives 2 and 0, Wiktionary gives 2; the list states 2.',
    )
    expect(
      wordFlag(
        word({
          text: 'お祭り',
          kana: 'おまつり',
          accentType: 0,
          unidic: [],
          wiktionary: [],
        }),
      ),
    ).toBe(
      'お祭り (おまつり): UniDic has no entry for it, Wiktionary gives no accent; the list states 0.',
    )
  })

  it('checks no word said by a rule', () => {
    expect(
      wordFlag(
        word({
          text: '渡ります',
          kana: 'わたります',
          accentType: 4,
          byRule: 'ます',
        }),
      ),
    ).toBeUndefined()
  })
})

const line = (fields: Partial<StarterListLine> = {}): StarterListLine => ({
  id: 'neko-ga',
  level: 'starter-atamadaka',
  text: '猫が',
  kana: 'ねこが',
  words: [
    word({
      text: '猫',
      kana: 'ねこ',
      accentType: 1,
      particle: 'が',
      unidic: [1],
      wiktionary: [1],
    }),
  ],
  recording: { kind: 'Voicevox', voice: 'meimei-himari' },
  review: { verdict: 'unreviewed' },
  ...fields,
})

const list = (lines: ReadonlyArray<StarterListLine>): StarterList => ({
  version: 1,
  levels: [
    { id: 'starter-atamadaka', kind: 'Atamadaka', name: 'A', about: 'B' },
  ],
  lines,
})

describe('listProblems', () => {
  it('passes a whole, checked list', () => {
    expect(listProblems(list([line()]))).toEqual([])
  })

  it('names a line whose words do not make its text or kana, or is unchecked or stale', () => {
    expect(
      listProblems(
        list([
          line({ text: '猫を' }),
          line({ id: 'b', kana: 'ねこを' }),
          line({
            id: 'c',
            words: [
              word({ text: '猫', kana: 'ねこ', accentType: 1, particle: 'が' }),
            ],
          }),
          line({ id: 'd', flag: 'old' }),
          line({
            id: 'd',
            level: 'starter-none',
            words: [
              word({
                text: '猫',
                kana: 'ねこ',
                accentType: 3,
                particle: 'が',
                unidic: [1],
                wiktionary: [1],
              }),
            ],
          }),
        ]),
      ),
    ).toEqual([
      'neko-ga: its words make 猫が, not 猫を',
      'b: its words read ねこが, not ねこを',
      'c: 猫 is not checked yet: run the script with --accents',
      'c: its flag is not what its sources give: run the script with --accents',
      'd: its flag is not what its sources give: run the script with --accents',
      'd: the id is used twice',
      'd: no level starter-none',
      'd: 猫 has 2 morae, so no accent type 3',
      'd: its flag is not what its sources give: run the script with --accents',
    ])
  })
})

describe('creditOf', () => {
  it('keeps a CC BY-SA recording under CC BY-SA, as its licence asks of a change', () => {
    const credit = creditOf({
      kind: 'Commons',
      file: 'File:a.wav',
      page: 'https://commons.wikimedia.org/wiki/File:a.wav',
      url: 'https://upload.wikimedia.org/a.wav',
      bytes: 1,
      sha256: '0'.repeat(64),
      author: 'Someone',
      licence: 'CC BY-SA 4.0',
      licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
    })
    expect(credit.licence).toBe('CC BY-SA 4.0')
    expect(credit.changes).toBe(
      'Mixed to mono and resampled to 24 kHz, under CC BY-SA 4.0 as the original.',
    )
  })

  it('credits a VOICEVOX voice by its terms', () => {
    expect(
      creditOf({ kind: 'Voicevox', voice: 'kurono-takehiro' }),
    ).toMatchObject({
      author: 'VOICEVOX:玄野武宏',
      licence: 'VOICEVOX:玄野武宏 terms of use',
    })
  })
})

describe('recipeOf', () => {
  it('changes with what a VOICEVOX file is made from, and only that', () => {
    const before = recipeOf(line())
    expect(
      recipeOf(
        line({ review: { verdict: 'accept', reviewedOn: '2026-12-01' } }),
      ),
    ).toBe(before)
    expect(
      recipeOf(
        line({ recording: { kind: 'Voicevox', voice: 'kurono-takehiro' } }),
      ),
    ).not.toBe(before)
    expect(
      recipeOf(
        line({
          words: [
            word({ text: '猫', kana: 'ねこ', accentType: 0, particle: 'が' }),
          ],
        }),
      ),
    ).not.toBe(before)
  })
})

describe('applyReview', () => {
  it('writes each verdict, and a corrected accent with the one before it', () => {
    const next = applyReview(
      list([line(), line({ id: 'b' }), line({ id: 'c' })]),
      {
        reviewedOn: '2026-12-01',
        reviewer: 'R',
        verdicts: [
          { lineId: 'neko-ga', verdict: 'accept' },
          { lineId: 'b', verdict: 'correct', accentType: 0, note: 'flat here' },
        ],
      },
    )
    expect(next.lines[0]?.review).toEqual({
      verdict: 'accept',
      reviewedOn: '2026-12-01',
      reviewer: 'R',
    })
    expect(next.lines[1]?.words[0]?.accentType).toBe(0)
    expect(next.lines[1]?.review).toEqual({
      verdict: 'correct',
      reviewedOn: '2026-12-01',
      reviewer: 'R',
      accentType: 0,
      statedBefore: 1,
      note: 'flat here',
    })
    expect(next.lines[1]?.flag).toBe(lineFlag(next.lines[1]!))
    expect(next.lines[1]?.flag).toContain('the list states 0')
    expect(next.lines[2]?.review).toEqual({ verdict: 'unreviewed' })
  })

  it('refuses a review that names a line the list has not, or corrects to nothing', () => {
    expect(() =>
      applyReview(list([line()]), {
        reviewedOn: '2026-12-01',
        verdicts: [{ lineId: 'gone', verdict: 'accept' }],
      }),
    ).toThrow('gone')
    expect(() =>
      applyReview(list([line()]), {
        reviewedOn: '2026-12-01',
        verdicts: [{ lineId: 'neko-ga', verdict: 'correct' }],
      }),
    ).toThrow('no accent type')
  })
})

describe('a downloaded recording made the pack’s file', () => {
  const formats = join(import.meta.dirname, '..', '..', 'fixtures', 'formats')
  const made = (file: string, from?: number, to?: number) =>
    decodeWav(convertRecording(readFileSync(join(formats, file)), from, to))
  const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0

  it('makes a WAV one channel of 16-bit PCM at the pack’s rate, cut to its stretch when given', () => {
    const whole = made('pcm16.wav')
    expect(whole.sampleRate).toBe(packSampleRate)
    expect(whole.channels).toHaveLength(1)
    expect(whole.channels[0]?.length).toBe(4 * packSampleRate)
    expect(made('pcm16.wav', 1, 2.5).channels[0]?.length).toBe(
      1.5 * packSampleRate,
    )
  })

  // Commons serves OGG and FLAC as often as WAV, and LibriVox MP3.
  it.runIf(hasFfmpeg)(
    'decodes any other format the sources serve, OGG, FLAC and MP3, to the same audio',
    () => {
      const wav = made('pcm16.wav').channels[0] ?? new Float32Array()
      for (const file of ['vorbis.ogg', 'flac.flac', 'mp3.mp3']) {
        const other = made(file)
        expect(other.sampleRate).toBe(packSampleRate)
        expect(other.channels).toHaveLength(1)
        const samples = other.channels[0] ?? new Float32Array()
        // An MP3 decoder's padding may add a frame or so at the end.
        expect(Math.abs(samples.length - wav.length)).toBeLessThan(
          0.06 * packSampleRate,
        )
        const energy = (values: Float32Array) =>
          values.reduce((sum, value) => sum + value * value, 0)
        // A lossy coder drops the highest band, a tenth of the energy
        // at most here.
        const ratio = energy(samples) / energy(wav)
        expect(ratio).toBeGreaterThan(0.85)
        expect(ratio).toBeLessThan(1.1)
      }
    },
  )
})
