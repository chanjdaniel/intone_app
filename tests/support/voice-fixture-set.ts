// What the VOICEVOX fixtures hold: three phrases of about 4, 8 and 18
// morae, each said by every voice in its right Tokyo accent and in the
// variants a learner's take may show, each also in room noise and through
// a phone-like band. `npm run fixtures:voices` writes them to
// fixtures/voices/ (fixtures/README.md).
//
// The kana is VOICEVOX's AquesTalk-like notation: `'` after the accent
// phrase's last high mora (after its last mora when the phrase does not
// fall), `/` between accent phrases, `、` for a pause, `_` before a
// devoiced mora.

export type Phrase = Readonly<{
  id: string
  text: string
  reading: string
  // The right accent, and the wrong ones made from it.
  right: string
  // One accent phrase's fall moved to another mora.
  fallMoved: string
  // The same phrase with no fall in it.
  fallLost: string
  // One mora's sound changed, every accent kept.
  moraChanged: string
  // What changed in each wrong variant, said plainly for the labels.
  changes: Readonly<{
    fallMoved: string
    fallLost: string
    moraChanged: string
  }>
}>

export const phrases: ReadonlyArray<Phrase> = [
  {
    // Ticket 09's bundled line: 雨 is atamadaka (あ↓め), and the fall
    // lost gives 飴が好き, a real minimal pair.
    id: 'ame-ga-suki',
    text: '雨が好き',
    reading: 'あめがすき',
    right: "ア'メガ/_スキ'",
    fallMoved: "アメ'ガ/_スキ'",
    fallLost: "アメガ'/_スキ'",
    moraChanged: "ア'ネガ/_スキ'",
    changes: {
      fallMoved: 'あめが falls after め instead of after あ',
      fallLost: 'あめが does not fall (飴が)',
      moraChanged: 'め is said ね, the accent kept',
    },
  },
  {
    // 橋 is odaka (はし↓を), 箸 atamadaka (は↓しを), 端 heiban (はしを).
    id: 'hashi-o-watarimasu',
    text: '橋を渡ります',
    reading: 'はしをわたります',
    right: "ハシ'オ/ワタリマ'_ス",
    fallMoved: "ハ'シオ/ワタリマ'_ス",
    fallLost: "ハシオ'/ワタリマ'_ス",
    moraChanged: "ハス'オ/ワタリマ'_ス",
    changes: {
      fallMoved: 'はしを falls after は instead of after し (箸を)',
      fallLost: 'はしを does not fall (端を)',
      moraChanged: 'し is said す, the accent kept',
    },
  },
  {
    // 今日 atamadaka, 駅 atamadaka, 古い ふる↓い, 友達 heiban, 会いました
    // あいま↓した; a pause after the topic.
    id: 'kyou-wa-eki-de',
    text: '今日は駅で古い友達に会いました',
    reading: 'きょうはえきでふるいともだちにあいました',
    right: "キョ'オワ、エ'キデ/フル'イ/トモダチニ'/アイマ'_シタ",
    fallMoved: "キョ'オワ、エキ'デ/フル'イ/トモダチニ'/アイマ'_シタ",
    fallLost: "キョ'オワ、エキデ'/フル'イ/トモダチニ'/アイマ'_シタ",
    moraChanged: "キョ'オワ、エ'キデ/フル'イ/トモラチニ'/アイマ'_シタ",
    changes: {
      fallMoved: 'えきで falls after き instead of after え',
      fallLost: 'えきで does not fall',
      moraChanged: 'だ is said ら, the accent kept',
    },
  },
]

export const variants = [
  'right',
  'fall-moved',
  'fall-lost',
  'mora-changed',
  'slower',
  'faster',
  'uneven',
] as const
export type Variant = (typeof variants)[number]

// Each variant's kana and the query changes it asks of the synthesiser.
export type Synthesis = Readonly<{
  kana: string
  speedScale: number
  // Each mora's vowel length scale, in order, or none to keep VOICEVOX's.
  vowelLengthScales: ReadonlyArray<number> | null
}>

// Slower and faster by a quarter, a learner's usual spread of tempo.
export const slowerSpeedScale = 0.8
export const fasterSpeedScale = 1.25

export const conditions = ['clean', 'room', 'phone'] as const
export type Condition = (typeof conditions)[number]

// An ordinary room's noise under speech, well above the take's own
// too-noisy gate (src/engine/pitch/take.ts).
export const roomSnrDb = 20

export type Voice = Readonly<{
  id: string
  name: string
  styleId: number
  // The VVM file in voicevox_vvm 0.17.1 that holds the voice.
  model: string
  credit: string
  termsUrl: string
}>

// Voices whose own terms let their audio be used with a credit alone,
// with no prior check for any user and no ban on passing the audio on
// (fixtures/README.md).
export const voices: ReadonlyArray<Voice> = [
  {
    id: 'shikoku-metan',
    name: '四国めたん',
    styleId: 2,
    model: '0.vvm',
    credit: 'VOICEVOX:四国めたん',
    termsUrl: 'https://zunko.jp/con_ongen_kiyaku.html',
  },
  {
    id: 'zundamon',
    name: 'ずんだもん',
    styleId: 3,
    model: '0.vvm',
    credit: 'VOICEVOX:ずんだもん',
    termsUrl: 'https://zunko.jp/con_ongen_kiyaku.html',
  },
  {
    id: 'kyushu-sora',
    name: '九州そら',
    styleId: 16,
    model: '2.vvm',
    credit: 'VOICEVOX:九州そら',
    termsUrl: 'https://zunko.jp/con_ongen_kiyaku.html',
  },
  {
    id: 'meimei-himari',
    name: '冥鳴ひまり',
    styleId: 14,
    model: '1.vvm',
    credit: 'VOICEVOX:冥鳴ひまり',
    termsUrl: 'https://www.meimeihimari.com/terms-of-use',
  },
  {
    id: 'chugoku-usagi',
    name: '中国うさぎ',
    styleId: 61,
    model: '3.vvm',
    credit: 'VOICEVOX:中国うさぎ',
    termsUrl: 'https://zunko.jp/con_ongen_kiyaku.html',
  },
  {
    id: 'kurono-takehiro',
    name: '玄野武宏',
    styleId: 11,
    model: '4.vvm',
    credit: 'VOICEVOX:玄野武宏',
    termsUrl: 'https://www.virvoxproject.com/voicevoxの利用規約',
  },
  {
    id: 'kenzaki-mesuo',
    name: '剣崎雌雄',
    styleId: 21,
    model: '4.vvm',
    credit: 'VOICEVOX:剣崎雌雄',
    termsUrl: 'https://frontier.creatia.cc/fanclubs/413/posts/4507',
  },
  {
    id: 'shirakami-kotaro',
    name: '白上虎太郎',
    styleId: 12,
    model: '9.vvm',
    credit: 'VOICEVOX:白上虎太郎',
    termsUrl: 'https://www.virvoxproject.com/voicevoxの利用規約',
  },
]

export const fixtureId = (
  phrase: string,
  voice: string,
  variant: Variant,
  condition: Condition,
): string =>
  `${phrase}/${voice}/${variant}${condition === 'clean' ? '' : `.${condition}`}`
