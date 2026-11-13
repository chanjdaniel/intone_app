import { Effect } from 'effect'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { ensureCached, readModelList } from '../../build/models.ts'
import { sampleReadingLines } from '../../src/app/dev/sampleReadings.ts'
import {
  type ReadingWord,
  hasKanji,
  wordsOf,
} from '../../src/engine/text/readings.ts'
import { openTokeniser } from '../../src/workers/lindera-session.ts'
import { linderaWasmBytes } from '../../src/workers/readings-protocol.ts'
import { root } from '../support/run.ts'

// The readings Worker's own tokeniser (src/workers/lindera-session.ts) on
// the real dictionary under Node: Lindera's WebAssembly as installed, and
// the zip models.json lists, fetched into .cache/models/ once. The CC0
// clips' readings below are the ones docs/readings.md judged word by word.

const wasmPath = join(
  root,
  'node_modules',
  'lindera-wasm',
  'lindera_wasm_bg.wasm',
)

const dictionaryZip = async (): Promise<Uint8Array> => {
  const list = await readModelList(join(root, 'models.json'))
  const dictionary = list.find(model => model.id === 'lindera-ipadic')
  if (dictionary === undefined || dictionary.files.length !== 1) {
    throw new Error('models.json lists no lindera-ipadic of one file')
  }
  return readFileSync(
    await ensureCached(
      dictionary.id,
      dictionary.files[0],
      join(root, '.cache', 'models'),
    ),
  )
}

// Each text's tokens, as the readings Worker posts them.
const tokenAll = async (texts: ReadonlyArray<string>) => {
  const zip = await dictionaryZip()
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const tokeniser = yield* openTokeniser(zip, readFileSync(wasmPath))
        return yield* Effect.forEach(texts, text => tokeniser.tokenise(text))
      }),
    ),
  )
}

// Each text's words, as the readings service gives them to the page.
const readAll = async (
  texts: ReadonlyArray<string>,
): Promise<ReadonlyArray<ReadonlyArray<ReadingWord>>> =>
  (await tokenAll(texts)).map((tokens, k) => wordsOf(texts[k] ?? '', tokens))

// A text's words with kanji, as `surface(kana)`.
const kanjiWords = (words: ReadonlyArray<ReadingWord>): ReadonlyArray<string> =>
  words
    .filter(word => hasKanji(word.surface))
    .map(word => `${word.surface}(${word.kana ?? ''})`)

// Every word with kanji in each CC0 clip's text (fixtures/real/), as the
// dictionary cuts it, with the reading the text gives it in context.
const judged: Readonly<Record<string, string>> = {
  gongitsune:
    '私(わたし) 村(むら) 中山(なかやま) 小さな(ちいさな) 城(しろ) 中山(なかやま) 中山(なかやま) 少し(すこし) 山(やま) 中(なか) 狐(きつね) 狐(きつね) 一人ぼっち(ひとりぼっち) 小(こ) 狐(ぎつね) 一ぱい(いっぱい) 森(もり) 中(なか) 穴(あな) 住ん(すん) 夜(よる) 昼(ひる)',
  'good-bye':
    '帰り(かえり) 二(ふた) 人(り) 男(おとこ) 相合傘(あいあいがさ) 歩い(あるい) 逝去(せいきょ) 老大家(ろうたいか) 義理(ぎり) 一(いっ) 話題(わだい) 女(おんな) 就い(つい) 極めて(きわめて) 不(ふ) 事(こと) 紋服(もんぷく) 初老(しょろう) 大男(おおおとこ) 文士(ぶんし) 若い(わかい) ロイド眼鏡(ろいどめがね) 縞(しま) 好男子(こうだんし) 編集(へんしゅう) 者(しゃ) 文士(ぶんし) 言う(いう) 女(おんな) 好き(すき) お前(おまえ) 年貢(ねんぐ) 時(どき)',
  romandourou:
    '変(へん) 調子(ちょうし) 案外(あんがい) 暮し(くらし) 正しい(ただしい) 私(わたし) 一般(いっぱん) 家庭(かてい) 変(へん) 調子(ちょうし) 知れ(しれ) 入江(いりえ) 家(いえ) 空気(くうき) 普通(ふつう) 家(いえ) 少し(すこし) 違っ(ちがっ) 家庭(かてい) 空気(くうき) 暗示(あんじ) 得(え) 私(わたし) 前(まえ) 一つ(ひとつ) 短篇(たんぺん) 小説(しょうせつ) 創っ(つくっ) 事(こと) 私(わたし) 不(ふ) 流行(りゅうこう) 作家(さっか) 創っ(つくっ) 作品(さくひん) 雑誌(ざっし) 載せ(のせ) 事(こと) 出来(でき) 短篇(たんぺん) 小説(しょうせつ) 永い(ながい) 間(あいだ) 私(わたし) 机(つくえ) 引き出し(ひきだし) 底(そこ) その他(そのた) 私(わたし) 三つ(みっつ) 四つ(よっつ) 未(み) 発表(はっぴょう) 謂わ(いわ) 筐(きょう) 底(てい) 深く(ふかく) 秘め(ひめ) 作品(さくひん) 早春(そうしゅん) 一纏め(ひとまとめ) 単行(たんこう) 本(ほん) 出版(しゅっぱん) 創作(そうさく) 集(しゅう)',
}

describe("the readings Worker's tokeniser, on the real dictionary", () => {
  test("knows Lindera's WebAssembly by its size, which the download is shown with", () => {
    expect(statSync(wasmPath).size).toBe(linderaWasmBytes)
  })

  test("gives the /dev readings entry's lines the tokens it shows them with", async () => {
    expect(
      await tokenAll(sampleReadingLines.map(line => line.text)),
    ).toStrictEqual(sampleReadingLines.map(line => line.tokens))
  })

  test('reads the bundled line', async () => {
    const [words] = await readAll(['雨が好き'])

    expect(words).toStrictEqual([
      { from: 0, to: 1, surface: '雨', kana: 'あめ' },
      { from: 1, to: 2, surface: 'が', kana: null },
      { from: 2, to: 4, surface: '好き', kana: 'すき' },
    ])
  })

  test("reads 112 of the CC0 clips' 121 words with kanji as their text does, and only these 9 otherwise", async () => {
    const clips = Object.keys(judged)
    const texts = clips.map(clip =>
      readFileSync(
        join(root, 'fixtures', 'real', `${clip}.txt`),
        'utf8',
      ).trim(),
    )
    const read = await readAll(texts)

    const differences = clips.flatMap((clip, k) => {
      const got = kanjiWords(read[k] ?? [])
      const want = (judged[clip] ?? '').split(' ')
      expect(got.length, clip).toBe(want.length)
      return got.flatMap((word, n) =>
        word === want[n] ? [] : [`${clip}: ${word}, not ${want[n]}`],
      )
    })

    expect(read.flatMap(kanjiWords)).toHaveLength(121)
    expect(differences).toStrictEqual([
      'gongitsune: 小(しょう), not 小(こ)',
      'gongitsune: 狐(きつね), not 狐(ぎつね)',
      'good-bye: 二(に), not 二(ふた)',
      'good-bye: 人(にん), not 人(り)',
      'good-bye: 一(いち), not 一(いっ)',
      'good-bye: 時(じ), not 時(どき)',
      'romandourou: 間(ま), not 間(あいだ)',
      'romandourou: 筐(かたみ), not 筐(きょう)',
      'romandourou: 底(そこ), not 底(てい)',
    ])
  })
})
