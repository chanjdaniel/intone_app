// Writes docs/sounds-study.md: each sound model of docs/sounds.md on the
// VOICEVOX fixtures, read against the bar stated there, and its frames
// tried as the score's aligner. Reads the frames
// scripts/sound-features.ts keeps in .cache/sounds/features/, and the
// fixtures' tracked curves. `npm run sounds:study`; `--out <file>`
// writes elsewhere. Run with `node --import ./scripts/source-imports.ts`,
// as the npm script does.

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import {
  type StudyAligner,
  type StudyPair,
  boundaryErrors,
  chanceAbove,
  isWrong,
  median,
  pitchSkillOf,
  quantile,
  rightVariants,
  studyAligners,
  studyFixture,
  studyPairs,
} from '../tests/support/score-study.ts'
import { soundModel, soundModels } from '../tests/support/sound-models.ts'
import {
  barRows,
  barVerdict,
  modelAligner,
  otherWordsDistances,
  soundsPairs,
  soundsScaleOf,
} from '../tests/support/sounds-study.ts'
import { fixtureId, phrases } from '../tests/support/voice-fixture-set.ts'

const root = join(import.meta.dirname, '..')
const { values } = parseArgs({
  options: {
    out: { type: 'string', default: join(root, 'docs', 'sounds-study.md') },
    model: { type: 'string', multiple: true },
  },
})

const two = (value: number): string =>
  Number.isFinite(value) ? value.toFixed(2) : '-'
const three = (value: number): string =>
  Number.isFinite(value) ? value.toFixed(3) : '-'
const whole = (value: number): string =>
  Number.isFinite(value) ? value.toFixed(0) : '-'
const table = (
  head: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string>>,
): string =>
  [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '-').join(' | ')} |`,
    ...rows.map(row => `| ${row.join(' | ')} |`),
  ].join('\n')
const models =
  values.model === undefined ? soundModels : values.model.map(soundModel)
const yes = (pass: boolean): string => (pass ? 'passes' : 'fails')

const out: Array<string> = [
  '# The sounds part on the fixtures',
  '',
  'Written by `npm run sounds:study` (scripts/sounds-study.ts) from the frames `npm run sounds:features` keeps in `.cache/sounds/features/` and from fixtures/tracked/.',
  'docs/sounds.md states the bar these numbers are read against, and what was done with them.',
  '',
  "A model's sounds part is its cosine DTW distance over the speech, on a scale where the clean right takes' median scores 1 and a take of other words' median scores 0.",
  '"Spread" is the widest gap between the seven other voices\' right takes of one native, phrase and condition; "same voice" is the share of right takes above the mora-changed take of the same native, take voice and condition; "across voices" is the chance a right take in any voice is above a mora-changed take in any voice, for the same native and condition.',
  '',
]

const verdicts: Array<string> = []
for (const model of models) {
  const pairs = soundsPairs(model)
  const otherWords = otherWordsDistances(model)
  const scale = soundsScaleOf(pairs, otherWords)
  const rows = barRows(pairs, scale)
  const verdict = barVerdict(rows)
  out.push(`## ${model.name}`, '')
  out.push(
    `Scale: a distance of ${three(scale.top)} scores 1 (the clean right takes' median) and ${three(scale.zero)} scores 0 (other words' median); a right take's distance runs ${three(
      quantile(
        pairs
          .filter(pair => pair.variant === 'right')
          .map(pair => pair.distance),
        0.1,
      ),
    )} to ${three(
      quantile(
        pairs
          .filter(pair => pair.variant === 'right')
          .map(pair => pair.distance),
        0.9,
      ),
    )} from its 10th to 90th percentile, other words' ${three(quantile(otherWords, 0.1))} to ${three(quantile(otherWords, 0.9))}.`,
    '',
  )
  out.push(
    table(
      [
        'Phrase',
        'Condition',
        'Spread, median',
        'Spread, worst',
        'Same voice',
        'Across voices',
        'Same voice, raw',
        'Across voices, raw',
        'Right, median part',
        'Mora changed, median part',
      ],
      rows.map(row => [
        `${row.phrase} (${row.morae})`,
        row.condition,
        two(row.spreadMedian),
        two(row.spreadWorst),
        three(row.sameVoice),
        three(row.acrossVoices),
        three(row.sameVoiceRaw),
        three(row.acrossVoicesRaw),
        two(row.rightMedian),
        two(row.changedMedian),
      ]),
    ),
    '',
  )
  const line = `Level across voices ${yes(verdict.level)}; a changed mora in the same voice ${yes(verdict.sameVoice)}; across voices ${yes(verdict.acrossVoices)}.`
  out.push(line, '')
  verdicts.push(`${model.id}: ${line}`)
}

// The aligners: ticket 10's chosen bands and its ceiling, beside each
// model's frames, on the same 3,528 pairs and numbers (docs/score.md,
// "The aligner").
const pairs = studyPairs()
const isRight = (pair: StudyPair) =>
  rightVariants.some(variant => variant === pair.variant)
const lengthOf = (phrase: string) =>
  studyFixture(fixtureId(phrase, 'zundamon', 'right', 'clean')).labels.phrase
    .morae
const aligners: ReadonlyArray<StudyAligner> = [
  ...studyAligners.filter(
    aligner =>
      aligner.name.endsWith('(chosen)') || aligner.name.endsWith('(ceiling)'),
  ),
  ...models.map(modelAligner),
]
out.push('## The aligners', '')
out.push(
  "Each model's last layer on the curve's frames, normalised per take over its speech and lined up by the score's DTW, beside ticket 10's chosen log mel bands and the labelled mora boundaries: the raw pitch skill on each path, and how far the path puts the native's labelled mora starts from the take's.",
  '',
)
out.push(
  table(
    [
      'Aligner',
      'Mora start error, median ms',
      'p90 ms',
      ...phrases.map(
        phrase => `Chance right beats wrong, ${lengthOf(phrase.id)} morae`,
      ),
      'Right, median skill',
      'Wrong, median skill',
    ],
    aligners.map(aligner => {
      const errors: Array<number> = []
      const skills = new Map<StudyPair, number>()
      for (const pair of pairs) {
        const path = aligner.path(pair)
        if (path === null) continue
        errors.push(...boundaryErrors(pair, path))
        skills.set(pair, pitchSkillOf(pair, path))
      }
      const skillsOf = (keep: (pair: StudyPair) => boolean) =>
        pairs.filter(keep).flatMap(pair => skills.get(pair) ?? [])
      return [
        aligner.name,
        whole(median(errors)),
        whole(quantile(errors, 0.9)),
        ...phrases.map(phrase =>
          three(
            chanceAbove(
              skillsOf(pair => pair.phrase === phrase.id && isRight(pair)),
              skillsOf(
                pair => pair.phrase === phrase.id && isWrong(pair.variant),
              ),
            ),
          ),
        ),
        two(median(skillsOf(isRight))),
        two(median(skillsOf(pair => isWrong(pair.variant)))),
      ]
    }),
  ),
  '',
)

writeFileSync(values.out ?? '', out.join('\n'))
for (const verdict of verdicts) console.log(verdict)
