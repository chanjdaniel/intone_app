// What scripts/starter-pack.ts makes from the source list, as plain
// functions it and the tests share: each word's flag from what UniDic and
// Wiktionary give, the kana VOICEVOX is asked to say, a recording's
// credit, the key of what a file is made from, the pack line, CREDITS.md
// and the review's verdicts written into the list (docs/starter-set.md).

import { createHash } from 'node:crypto'

import { moraeOf } from '../../src/engine/text/morae.ts'
import {
  type ReviewExport,
  type StarterCredit,
  type StarterList,
  type StarterListLine,
  type StarterPack,
  type StarterPackLine,
  type StarterRecording,
  type StarterWord,
  isShareAlike,
  reviewNote,
} from '../../src/services/starter-records.ts'

// The rate every bundled file is written at: VOICEVOX's own, and half
// the 48 kHz of the Lingua Libre files, well above what a voice needs.
export const packSampleRate = 24000

// Bumped when the way a file is made changes, so every file is remade.
export const makerVersion = 1

// The VOICEVOX voices the set uses, with the terms fixtures/README.md
// records, and each voice's pitch levels in log Hz: VOICEVOX's own
// predictions for the fixtures' right accents, the 10th and 90th
// percentile of their voiced morae (`pitchLevelsOf` in
// ./voice-fixtures.ts, measured once and pinned here, so adding a line
// never moves another's pitch).
export type StarterVoice = Readonly<{
  id: 'meimei-himari' | 'kurono-takehiro'
  name: string
  styleId: number
  model: string
  termsUrl: string
  levels: Readonly<{ low: number; high: number }>
}>

export const starterVoices: ReadonlyArray<StarterVoice> = [
  {
    id: 'meimei-himari',
    name: '冥鳴ひまり',
    styleId: 14,
    model: '1.vvm',
    termsUrl: 'https://www.meimeihimari.com/terms-of-use',
    levels: { low: 5.3561811447143555, high: 5.676870822906494 },
  },
  {
    id: 'kurono-takehiro',
    name: '玄野武宏',
    styleId: 11,
    model: '4.vvm',
    termsUrl: 'https://www.virvoxproject.com/voicevoxの利用規約',
    levels: { low: 4.663162708282471, high: 5.116941928863525 },
  },
]

export const voiceOf = (id: StarterVoice['id']): StarterVoice => {
  const voice = starterVoices.find(found => found.id === id)
  if (voice === undefined) throw new Error(`no voice ${id}`)
  return voice
}

const katakana = (text: string): string =>
  text.replace(/[ぁ-ゖ]/g, char =>
    String.fromCharCode(char.charCodeAt(0) + 0x60),
  )

const vowels: ReadonlyArray<readonly [string, string]> = [
  ['ア', 'アカガサザタダナハバパマヤラワァャヮ'],
  ['イ', 'イキギシジチヂニヒビピミリィ'],
  ['ウ', 'ウクグスズツヅヌフブプムユルゥュヴ'],
  ['エ', 'エケゲセゼテデネヘベペメレェ'],
  ['オ', 'オコゴソゾトドノホボポモヨロヲォョ'],
]

const vowelOf = (mora: string): string | undefined =>
  vowels.find(([, kana]) => kana.includes(mora.slice(-1)))?.[0]

// A particle as it is said: を as お, は as わ, へ as え.
const saidParticle: Readonly<Record<string, string>> = {
  を: 'オ',
  は: 'ワ',
  へ: 'エ',
}

// The kana VOICEVOX CORE is asked to say, in its AquesTalk-like
// notation: each word with its particle one accent phrase, `/` between
// them, and `'` after the last high mora, after the particle when the
// word is heiban. A long vowel is written as the vowel it is said as
// (がっこう as ガッコオ, せんせい as センセエ, コーヒー as コオヒイ),
// since the notation reads ウ as u and has no ー.
export const voicevoxKana = (words: ReadonlyArray<StarterWord>): string =>
  words
    .map(word => {
      const morae = moraeOf(katakana(word.kana)).map((mora, k, all) => {
        const before = k === 0 ? undefined : vowelOf(all[k - 1] ?? '')
        if (mora === 'ー' && before !== undefined) return before
        if (mora === 'ウ' && before === 'オ') return 'オ'
        if (mora === 'イ' && before === 'エ') return 'エ'
        return mora
      })
      const particle =
        word.particle === undefined
          ? []
          : [saidParticle[word.particle] ?? katakana(word.particle)]
      const said = [...morae, ...particle]
      const high = word.accentType === 0 ? said.length : word.accentType
      return [...said.slice(0, high), "'", ...said.slice(high)].join('')
    })
    .join('/')

// Wiktionary's `{{ja-pron}}` for a reading, read from a page's Japanese
// section: every accent it lists (`acc`, `acc2`, ...), but not one it
// gives for a place (`acc2_loc=Osaka`), as accent types: h heiban 0, a
// atamadaka 1, o odaka the word's morae; n, nakadaka with no number,
// says too little and is left out. A template with no reading is the
// page's own, so it counts too.
export const wiktionaryAccents = (
  wikitext: string,
  kana: string,
): ReadonlyArray<number> => {
  const japanese =
    wikitext.split(/^==Japanese==\s*$/m)[1]?.split(/^==[^=]/m)[0] ?? ''
  const plain = japanese
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
  const wanted = katakana(kana)
  const morae = moraeOf(kana).length
  const found: Array<number> = []
  for (const match of plain.matchAll(
    /\{\{ja-pron\|((?:[^{}]|\{\{[^{}]*\}\})*)\}\}/g,
  )) {
    const parts = (match[1] ?? '')
      .replace(/\{\{[^{}]*\}\}/g, '')
      .split('|')
      .map(part => part.trim())
    const readings = parts
      .filter(part => !part.includes('='))
      .map(part => katakana(part.replace(/[.\s^-]/g, '')))
    if (readings.length > 0 && !readings.includes(wanted)) continue
    const named = new Map(
      parts
        .filter(part => part.includes('='))
        .map(part => {
          const at = part.indexOf('=')
          return [part.slice(0, at), part.slice(at + 1)] as const
        }),
    )
    for (const [key, value] of named) {
      const number = /^acc(\d*)$/.exec(key)?.[1]
      if (number === undefined) continue
      if (named.has(`acc${number}_loc`)) continue
      const type =
        value === 'h'
          ? 0
          : value === 'a'
            ? 1
            : value === 'o'
              ? morae
              : /^\d+$/.test(value)
                ? Number(value)
                : undefined
      if (type !== undefined && !found.includes(type)) found.push(type)
    }
  }
  return found
}

// UniDic's lexicon as its compiled MeCab dictionary holds it: the
// feature strings, which follow the header (72 bytes), the double array
// and the token table, each sized in the header.
export type UnidicEntry = ReadonlyArray<string>

export const unidicFeatures = (
  dictionary: Uint8Array,
): ReadonlyMap<string, ReadonlyArray<UnidicEntry>> => {
  const view = new DataView(
    dictionary.buffer,
    dictionary.byteOffset,
    dictionary.byteLength,
  )
  const arraySize = view.getUint32(24, true)
  const tokenSize = view.getUint32(28, true)
  const featureSize = view.getUint32(32, true)
  const start = 72 + arraySize + tokenSize
  const text = new TextDecoder().decode(
    dictionary.subarray(start, start + featureSize),
  )
  const byOrth = new Map<string, Array<UnidicEntry>>()
  for (const feature of text.split('\0')) {
    const fields = csvFields(feature)
    const orth = fields[8]
    if (orth === undefined || fields.length < 25) continue
    const entries = byOrth.get(orth) ?? []
    entries.push(fields)
    byOrth.set(orth, entries)
  }
  return byOrth
}

const csvFields = (line: string): ReadonlyArray<string> => {
  const fields: Array<string> = []
  let field = ''
  let quoted = false
  for (const char of line) {
    if (char === '"') quoted = !quoted
    else if (char === ',' && !quoted) {
      fields.push(field)
      field = ''
    } else field += char
  }
  fields.push(field)
  return fields
}

// The accent types UniDic gives a word as a dictionary entry: its
// entries written as the word is, read as its kana, in their base form,
// not a proper name, each `aType` (UniDic 2023.02's field 24, "2,0" when
// it gives two) in the order it gives them.
export const unidicAccents = (
  features: ReadonlyMap<string, ReadonlyArray<UnidicEntry>>,
  text: string,
  kana: string,
): ReadonlyArray<number> => {
  const found: Array<number> = []
  for (const fields of features.get(text) ?? []) {
    const isBase =
      (fields[14] === '*' || fields[14] === '基本形') && fields[16] === '*'
    if (fields[20] !== katakana(kana) || !isBase || fields[1] === '固有名詞')
      continue
    for (const type of (fields[24] ?? '').split(',')) {
      if (/^\d+$/.test(type) && !found.includes(Number(type)))
        found.push(Number(type))
    }
  }
  return found
}

const listed = (types: ReadonlyArray<number>): string =>
  types.length === 1 ? String(types[0]) : types.join(' and ')

// Where the sources disagree with each other or with the accent the
// list states, said plainly; none when both give the stated type alone.
export const wordFlag = (word: StarterWord): string | undefined => {
  if (word.byRule !== undefined) return undefined
  const name = `${word.text} (${word.kana})`
  const unidic = word.unidic ?? []
  const wiktionary = word.wiktionary ?? []
  const agrees = (types: ReadonlyArray<number>) =>
    types.length === 1 && types[0] === word.accentType
  if (agrees(unidic) && agrees(wiktionary)) return undefined
  const said = [
    unidic.length === 0
      ? 'UniDic has no entry for it'
      : `UniDic gives ${listed(unidic)}`,
    wiktionary.length === 0
      ? 'Wiktionary gives no accent'
      : `Wiktionary gives ${listed(wiktionary)}`,
  ]
  return `${name}: ${said.join(', ')}; the list states ${word.accentType}.`
}

export const lineFlag = (line: StarterListLine): string | undefined => {
  const flags = line.words.flatMap(word => {
    const flag = wordFlag(word)
    return flag === undefined ? [] : [flag]
  })
  return flags.length === 0 ? undefined : flags.join(' ')
}

// What is wrong with the list, each named by its line: anything the
// Schema cannot see.
export const listProblems = (list: StarterList): ReadonlyArray<string> => {
  const problems: Array<string> = []
  const levelIds = new Set(list.levels.map(level => level.id))
  const seen = new Set<string>()
  for (const line of list.lines) {
    const named = (problem: string) => problems.push(`${line.id}: ${problem}`)
    if (seen.has(line.id)) named('the id is used twice')
    seen.add(line.id)
    if (!levelIds.has(line.level)) named(`no level ${line.level}`)
    const text = line.words.map(w => w.text + (w.particle ?? '')).join('')
    const kana = line.words.map(w => w.kana + (w.particle ?? '')).join('')
    if (text !== line.text) named(`its words make ${text}, not ${line.text}`)
    if (kana !== line.kana) named(`its words read ${kana}, not ${line.kana}`)
    for (const word of line.words) {
      const morae = moraeOf(word.kana).length
      if (word.accentType > morae)
        named(
          `${word.text} has ${morae} morae, so no accent type ${word.accentType}`,
        )
      if (
        word.byRule === undefined &&
        (word.unidic === undefined || word.wiktionary === undefined)
      )
        named(`${word.text} is not checked yet: run the script with --accents`)
    }
    if (line.flag !== lineFlag(line))
      named(
        'its flag is not what its sources give: run the script with --accents',
      )
  }
  for (const level of list.levels) {
    if (!list.lines.some(line => line.level === level.id))
      problems.push(`${level.id}: the level has no lines`)
  }
  return problems
}

// A recording's credit, as its licence or terms ask.
export const creditOf = (recording: StarterRecording): StarterCredit => {
  switch (recording.kind) {
    case 'Commons':
      return {
        author: recording.author,
        source: 'Wikimedia Commons',
        page: recording.page,
        licence: recording.licence,
        licenceUrl: recording.licenceUrl,
        changes: `Mixed to mono and resampled to ${packSampleRate / 1000} kHz${isShareAlike(recording.licence) ? `, under ${recording.licence} as the original` : ''}.`,
      }
    case 'LibriVox':
      return {
        author: recording.author,
        source: 'LibriVox',
        page: recording.page,
        licence: recording.licence,
        licenceUrl:
          recording.licence === 'CC0'
            ? 'https://creativecommons.org/publicdomain/zero/1.0/'
            : 'https://librivox.org/pages/public-domain/',
        changes: `Cut from ${recording.from} s to ${recording.to} s, mixed to mono and resampled to ${packSampleRate / 1000} kHz.`,
      }
    case 'Voicevox': {
      const voice = voiceOf(recording.voice)
      return {
        author: `VOICEVOX:${voice.name}`,
        source: 'VOICEVOX',
        page: voice.termsUrl,
        licence: `VOICEVOX:${voice.name} terms of use`,
        licenceUrl: voice.termsUrl,
        changes:
          'Synthesised by VOICEVOX CORE 0.17.1, its pitch set from the stated accent.',
      }
    }
  }
}

// What a line's file is made from, everything that changes its bytes,
// as a key.
export const recipeOf = (line: StarterListLine): string => {
  const recording = line.recording
  const recipe =
    recording.kind === 'Voicevox'
      ? {
          maker: makerVersion,
          voice: voiceOf(recording.voice),
          kana: voicevoxKana(line.words),
        }
      : recording.kind === 'Commons'
        ? { maker: makerVersion, sha256: recording.sha256 }
        : {
            maker: makerVersion,
            sha256: recording.sha256,
            from: recording.from,
            to: recording.to,
          }
  return createHash('sha256')
    .update(JSON.stringify(recipe))
    .digest('hex')
    .slice(0, 16)
}

// A recording's file, by any extension a browser plays.
export const audioExtensions = /\.(wav|mp3|ogg|oga|opus|flac|m4a|aac|webm)$/i

export const audioPathOf = (line: Pick<StarterListLine, 'id'>): string =>
  `audio/${line.id}.wav`

export const packLineOf = (
  line: StarterListLine,
  audio: Readonly<{ seconds: number; sha256: string }>,
): StarterPackLine => {
  const [first] = line.words
  return {
    id: line.id,
    seed: line.seed ?? false,
    text: line.text,
    kana: line.kana,
    morae: moraeOf(line.kana),
    accentType: first?.accentType ?? 0,
    particle: first?.particle ?? null,
    words: line.words.map(word => ({
      text: word.text,
      kana: word.kana,
      accentType: word.accentType,
      particle: word.particle ?? null,
      byRule: word.byRule ?? null,
    })),
    flag: line.flag ?? null,
    note: line.note ?? null,
    audio: audioPathOf(line),
    seconds: audio.seconds,
    sha256: audio.sha256,
    made: recipeOf(line),
    credit: creditOf(line.recording),
    review: line.review,
  }
}

// The pack from the list and each kept line's file: the levels in the
// list's order, each line in its level in the list's order; a line the
// review rejected is left out.
export const packOf = (
  list: StarterList,
  audioOf: (
    line: StarterListLine,
  ) => Readonly<{ seconds: number; sha256: string }>,
): StarterPack => ({
  version: 1,
  levels: list.levels.map(level => ({
    id: level.id,
    kind: level.kind,
    name: level.name,
    about: level.about,
    lines: list.lines
      .filter(
        line => line.level === level.id && line.review.verdict !== 'reject',
      )
      .map(line => packLineOf(line, audioOf(line))),
  })),
})

// The review's verdicts written into the list: each named line's
// review, and a corrected accent as its first word's, the one before
// it kept as `statedBefore`. A verdict for no line in the list is
// refused, so a stale export cannot be applied in part.
export const applyReview = (
  list: StarterList,
  review: ReviewExport,
): StarterList => {
  const byId = new Map(
    review.verdicts.map(verdict => [verdict.lineId, verdict]),
  )
  const unknown = [...byId.keys()].filter(
    id => !list.lines.some(line => line.id === id),
  )
  if (unknown.length > 0)
    throw new Error(
      `The review names lines the list has not: ${unknown.join(', ')}`,
    )
  return {
    ...list,
    lines: list.lines.map(line => {
      const verdict = byId.get(line.id)
      if (verdict === undefined) return line
      const [first, ...rest] = line.words
      if (first === undefined) return line
      const corrected =
        verdict.verdict === 'correct' && verdict.accentType !== undefined
      if (verdict.verdict === 'correct' && !corrected)
        throw new Error(`${line.id}: a correction names no accent type`)
      const words = corrected
        ? [
            { ...first, accentType: verdict.accentType ?? first.accentType },
            ...rest,
          ]
        : line.words
      const next: StarterListLine = {
        ...line,
        words,
        review: {
          verdict: verdict.verdict,
          reviewedOn: review.reviewedOn,
          ...(review.reviewer === undefined
            ? {}
            : { reviewer: review.reviewer }),
          ...(corrected
            ? { accentType: verdict.accentType, statedBefore: first.accentType }
            : {}),
          ...(verdict.note === undefined ? {} : { note: verdict.note }),
        },
      }
      const flag = lineFlag(next)
      const { flag: _, ...withoutFlag } = next
      return flag === undefined ? withoutFlag : { ...withoutFlag, flag }
    }),
  }
}

const cell = (text: string): string => text.replaceAll('|', '\\|')

// CREDITS.md, written whole from the pack: the line bundled since ticket
// 09, then every starter recording with its author, source, licence and
// what was done to it, as CC BY and CC BY-SA ask, and the sources of the
// accent types.
export const creditsMarkdown = (pack: StarterPack): string =>
  [
    '# Credits',
    '',
    'The recordings the app brings with it, and what their terms ask.',
    '`NOTICES.md` lists the software packages and models the app ships, with their licences.',
    'This file is written by `npm run starter:pack` from `starter/lines.json`; edit that list, never this file (`docs/starter-set.md`).',
    '',
    '## The first bundled line',
    '',
    '| Line | Voice | Made with | Terms |',
    '| - | - | - | - |',
    "| 雨が好き (あめがすき) | VOICEVOX:冥鳴ひまり (style 14) | [VOICEVOX CORE](https://github.com/VOICEVOX/voicevox_core) 0.17.1 | [冥鳴ひまり's terms of use](https://www.meimeihimari.com/terms-of-use) |",
    '',
    "The line's audio is `fixtures/voices/ame-ga-suki/meimei-himari/right.wav`, synthesised by VOICEVOX CORE with its pitch set from the Tokyo accent (`fixtures/README.md`).",
    '',
    '## The starter set',
    '',
    'Each recording with its author or voice, its source, its licence or terms, and what was done to it.',
    'A recording under CC BY-SA stays under CC BY-SA once resampled.',
    'The app shows the same credits on `/credits`, and each line its own on its practice screen.',
    '',
    ...pack.levels.flatMap(level => [
      `### ${level.name}`,
      '',
      '| Line | Speaker or voice | Source | Licence or terms | Changes | Review |',
      '| - | - | - | - | - | - |',
      ...level.lines.map(
        line =>
          `| ${cell(line.text)} (${cell(line.kana)}) | ${cell(line.credit.author)} | [${line.credit.source}](${line.credit.page}) | [${cell(line.credit.licence)}](${line.credit.licenceUrl}) | ${cell(line.credit.changes)} | ${reviewNote(line.review)} |`,
      ),
      '',
    ]),
    '## The VOICEVOX voices',
    '',
    'The VOICEVOX voice model terms require a credit that VOICEVOX was used, and bind the audio to each voice’s own terms, which whoever passes the audio on must pass on with it.',
    '冥鳴ひまり’s terms allow its use, commercial or not, by anyone, with a credit.',
    '玄野武宏’s terms (VirVox Project) allow its use, commercial or not, with a credit; audio passed on as material carries the same terms, and no acoustic model may be trained or fine-tuned on it.',
    '`fixtures/README.md` records each voice’s terms as read at source.',
    '',
    '## The accent types',
    '',
    'Each word’s accent type was checked against [UniDic](https://clrd.ninjal.ac.jp/unidic/) 2023.02 (現代書き言葉UniDic), used under its BSD licence, and against [Wiktionary](https://en.wiktionary.org/), whose accents, recorded in `starter/lines.json`’s `wiktionary` fields, are under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).',
    'No dictionary ships in the app.',
    '',
  ].join('\n')
