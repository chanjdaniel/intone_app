import type { Token } from '../../engine/text/readings'

// The readings entry's lines and their tokens, each as the readings
// Worker's tokeniser gives them on the real dictionary, which
// tests/readings/lindera.test.ts checks: the bundled line, and two lines
// of the CC0 clips' text (fixtures/real/), one with a reading the
// dictionary gets wrong (小狐, こぎつね) and one long enough to wrap.

const pairs = (
  tokens: ReadonlyArray<readonly [string, string]>,
): ReadonlyArray<Token> =>
  tokens.map(([surface, reading]) => ({ surface, reading }))

export const sampleReadingLines: ReadonlyArray<
  Readonly<{ text: string; tokens: ReadonlyArray<Token> }>
> = [
  {
    text: '雨が好き',
    tokens: pairs([
      ['雨', 'アメ'],
      ['が', 'ガ'],
      ['好き', 'スキ'],
    ]),
  },
  {
    text: 'ごんは、一人ぼっちの小狐で',
    tokens: pairs([
      ['ご', 'ゴ'],
      ['ん', 'ン'],
      ['は', 'ハ'],
      ['、', '、'],
      ['一人ぼっち', 'ヒトリボッチ'],
      ['の', 'ノ'],
      ['小', 'ショウ'],
      ['狐', 'キツネ'],
      ['で', 'デ'],
    ]),
  },
  {
    text: '入江の家の空気は、普通の家のそれとは少し違っているようである。',
    tokens: pairs([
      ['入江', 'イリエ'],
      ['の', 'ノ'],
      ['家', 'イエ'],
      ['の', 'ノ'],
      ['空気', 'クウキ'],
      ['は', 'ハ'],
      ['、', '、'],
      ['普通', 'フツウ'],
      ['の', 'ノ'],
      ['家', 'イエ'],
      ['の', 'ノ'],
      ['それ', 'ソレ'],
      ['と', 'ト'],
      ['は', 'ハ'],
      ['少し', 'スコシ'],
      ['違っ', 'チガッ'],
      ['て', 'テ'],
      ['いる', 'イル'],
      ['よう', 'ヨウ'],
      ['で', 'デ'],
      ['ある', 'アル'],
      ['。', '。'],
    ]),
  },
]
