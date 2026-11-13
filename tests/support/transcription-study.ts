import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// The measures and the document of scripts/transcription-study.ts, apart
// from the browser, so a test can check them on fixed text and remake the
// document from what the study keeps.

export const studyClips = ['romandourou', 'gongitsune', 'good-bye'] as const
export const studyModels = ['whisper-base', 'whisper-small'] as const
export const studyDevices = ['wasm', 'webgpu'] as const

export type StudyRun = Readonly<{
  clip: string
  model: string
  // What was asked for, and what the Worker says the encoder ran on.
  device: string
  ranOn: string
  gpu: string
  seconds: number
  windows: number
  openMilliseconds: number
  readMilliseconds: number
  text: string
  kana: string
  lines: ReadonlyArray<Readonly<{ from: number; to: number }>>
  // Each line's text as the app matches it, and as the model wrote the
  // line when it read it alone.
  matched: ReadonlyArray<string>
  ownTexts: ReadonlyArray<string>
}>

// The text as compared: no spaces and no punctuation, which a reader's
// pauses and a model's habits put in differently. The long-vowel mark
// stays: it is part of a word.
export const normalisedText = (text: string): string =>
  text.replace(
    /[\s　、。，．,.!?！？「」『』（）()〔〕［］[\]…‥―‐・〜~"'“”]/gu,
    '',
  )

const characters = (text: string): ReadonlyArray<string> => [...text]

// The edit distance between two texts, by character, with the pairs of
// places it lines up.
export const alignment = (
  from: string,
  to: string,
): Readonly<{
  edits: number
  pairs: ReadonlyArray<readonly [number, number]>
}> => {
  const a = characters(from)
  const b = characters(to)
  const cost = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) =>
      i === 0 ? j : j === 0 ? i : 0,
    ),
  )
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const row = cost[i] ?? []
      const above = cost[i - 1] ?? []
      row[j] = Math.min(
        (above[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
        (above[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
      )
    }
  }
  const pairs: Array<readonly [number, number]> = []
  let i = a.length
  let j = b.length
  while (i > 0 && j > 0) {
    const here = cost[i]?.[j] ?? 0
    if (
      here ===
      (cost[i - 1]?.[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1)
    ) {
      pairs.push([i - 1, j - 1])
      i -= 1
      j -= 1
    } else if (here === (cost[i - 1]?.[j] ?? 0) + 1) {
      i -= 1
    } else {
      j -= 1
    }
  }
  return { edits: cost[a.length]?.[b.length] ?? 0, pairs: pairs.reverse() }
}

// Character error: the edits from what was written to the reference, over
// the reference's length.
export const characterError = (written: string, reference: string): number => {
  const length = characters(reference).length
  return length === 0 ? 0 : alignment(written, reference).edits / length
}

// At each edge between two lines whose own reading has text: how many
// characters the matched text put on the wrong side of it, found by
// lining the two lines' matched text up with their own readings.
export const boundaryShifts = (
  matched: ReadonlyArray<string>,
  own: ReadonlyArray<string>,
): ReadonlyArray<number> =>
  matched.slice(1).flatMap((after, k) => {
    const before = normalisedText(matched[k] ?? '')
    const ownBefore = normalisedText(own[k] ?? '')
    const ownAfter = normalisedText(own[k + 1] ?? '')
    if (ownBefore === '' || ownAfter === '') {
      return []
    }
    const { pairs } = alignment(
      before + normalisedText(after),
      ownBefore + ownAfter,
    )
    const edge = characters(before).length
    const ownEdge = characters(ownBefore).length
    // The first character after the matched edge, and where it lies in
    // the own readings; with none lined up, the edge did not move.
    const lined = pairs.find(([at]) => at >= edge) ?? pairs.at(-1)
    if (lined === undefined) {
      return [0]
    }
    const [at, ownAt] = lined
    return [Math.abs(ownAt - (at - edge) - ownEdge)]
  })

const percent = (share: number): string => `${(100 * share).toFixed(1)}%`

const readRuns = (cache: string): ReadonlyArray<StudyRun> =>
  readdirSync(cache)
    .filter(file => /^[a-z-]+\.whisper-[a-z]+\.[a-z]+\.json$/.test(file))
    .sort()
    .map(file => JSON.parse(readFileSync(join(cache, file), 'utf8')))

const clipOrder: ReadonlyArray<string> = studyClips

const order = <
  A extends Readonly<{ clip: string; model: string; device: string }>,
>(
  runs: ReadonlyArray<A>,
): ReadonlyArray<A> =>
  [...runs].sort(
    (a, b) =>
      clipOrder.indexOf(a.clip) - clipOrder.indexOf(b.clip) ||
      a.model.localeCompare(b.model) ||
      a.device.localeCompare(b.device),
  )

export const transcriptionStudy = (cache: string, root: string): string => {
  const runs = order(readRuns(cache))
  const reference = (clip: string): Readonly<{ text: string; kana: string }> =>
    JSON.parse(readFileSync(join(cache, `${clip}.reference.json`), 'utf8'))
  const rows = runs.map(run => {
    const shifts = boundaryShifts(run.matched, run.ownTexts)
    return {
      run,
      written: characterError(
        normalisedText(run.text),
        normalisedText(reference(run.clip).text),
      ),
      kana: characterError(run.kana, reference(run.clip).kana),
      edges: shifts.length,
      wrong: shifts.filter(shift => shift >= 2).length,
      moved: shifts.reduce((sum, shift) => sum + shift, 0),
      empty: run.matched.filter(
        (text, k) =>
          normalisedText(text) === '' &&
          normalisedText(run.ownTexts[k] ?? '') !== '',
      ).length,
    }
  })
  const referenceLength = (clip: string) =>
    characters(normalisedText(reference(clip).text)).length
  const lines: Array<string> = [
    '<!-- Generated by `npm run text:study` from .cache/text-study/. Do not edit. -->',
    '',
    '# Transcription study',
    '',
    'The app’s own text Worker on the LibriVox CC0 clips of `fixtures/real/`, cut into lines by the app’s own code; `docs/transcription.md` says what it means.',
    `The references are the clips’ public-domain texts, \`fixtures/real/<clip>.txt\` (${studyClips.map(clip => `${clip} ${referenceLength(clip)} characters`).join(', ')}, punctuation left out).`,
    '',
    '## Character error',
    '',
    'Edits from what the model wrote to the reference, over the reference’s length, with spaces and punctuation left out; on the written form a word in kana where the text has kanji counts as wrong, on kana (OpenJTalk’s reading of both) only how it is said counts.',
    '',
    '| Clip | Model | Asked for | Ran on | Written form | Kana |',
    '| - | - | - | - | - | - |',
    ...rows.map(
      ({ run, written, kana }) =>
        `| ${run.clip} | ${run.model} | ${run.device} | ${run.ranOn} | ${percent(written)} | ${percent(kana)} |`,
    ),
    '',
    '## Text matched to lines',
    '',
    'At each edge between two lines whose own reading has text, the characters of the matched text on the wrong side of it, found by lining the two lines’ matched text up with what the model wrote reading each line alone; an edge is wrong when two or more moved. A line left empty has text when read alone and none matched.',
    '',
    '| Clip | Model | Asked for | Lines | Edges | Wrong edges | Characters moved | Lines left empty |',
    '| - | - | - | - | - | - | - | - |',
    ...rows.map(
      ({ run, edges, wrong, moved, empty }) =>
        `| ${run.clip} | ${run.model} | ${run.device} | ${run.lines.length} | ${edges} | ${wrong} | ${moved} | ${empty} |`,
    ),
    '',
    '## Speed',
    '',
    'The model already on the device: opening it (its sessions made), and reading the clip, as seconds of audio per second of reading.',
    '',
    '| Clip | Seconds | Windows | Model | Asked for | Ran on | GPU | Opening, s | Reading, s | Times real time |',
    '| - | - | - | - | - | - | - | - | - | - |',
    ...rows.map(
      ({ run }) =>
        `| ${run.clip} | ${run.seconds.toFixed(1)} | ${run.windows} | ${run.model} | ${run.device} | ${run.ranOn} | ${run.gpu} | ${(run.openMilliseconds / 1000).toFixed(1)} | ${(run.readMilliseconds / 1000).toFixed(1)} | ${(run.seconds / (run.readMilliseconds / 1000)).toFixed(2)} |`,
    ),
    '',
    '## The lines as matched',
    '',
    'whisper-base on WebAssembly: each line’s matched text, and what the model wrote reading the line alone.',
    '',
    ...order(
      runs.filter(run => run.model === 'whisper-base' && run.device === 'wasm'),
    ).flatMap(run => [
      `### ${run.clip}`,
      '',
      '| Line | Matched | Read alone |',
      '| - | - | - |',
      ...run.matched.map(
        (text, k) =>
          `| ${k + 1} | ${text.replaceAll('|', '\\|')} | ${(run.ownTexts[k] ?? '').replaceAll('|', '\\|')} |`,
      ),
      '',
    ]),
  ]
  void root
  return `${lines.join('\n').trimEnd()}\n`
}
