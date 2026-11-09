// Writes docs/score-study.md: the score's study on the VOICEVOX fixtures'
// tracked curves and features (fixtures/tracked/), the numbers
// docs/score.md rests on. `npm run score:study`; `--out <file>` writes
// elsewhere, and `--time` also prints how long a take takes to score.
// Run with `node --import ./scripts/source-imports.ts`, as the npm script
// does.

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import {
  dtwFailDistance,
  gainBand,
  lengthRatioBand,
  partWeights,
  pitchSkillTop,
  timingDeviationTop,
  timingDeviationZero,
} from '../src/score/constants.ts'
import { scoreTake } from '../src/score/score.ts'
import {
  type StudyPair,
  boundaryErrors,
  chanceAbove,
  flatTake,
  isWrong,
  median,
  pathDistance,
  pitchSkillOf,
  quantile,
  rankCorrelation,
  rightVariants,
  scored,
  spanScaled,
  studyAligners,
  studyFixture,
  studyPairs,
  tempoDeviationOf,
  voiceSpans,
  wrongVariants,
} from '../tests/support/score-study.ts'
import { readTracked } from '../tests/support/tracked-fixtures.ts'
import {
  conditions,
  fixtureId,
  phrases,
  voices,
} from '../tests/support/voice-fixture-set.ts'

const root = join(import.meta.dirname, '..')
const { values } = parseArgs({
  options: {
    out: { type: 'string', default: join(root, 'docs', 'score-study.md') },
    time: { type: 'boolean', default: false },
  },
})

const two = (value: number): string =>
  Number.isFinite(value) ? value.toFixed(2) : '-'
const three = (value: number): string =>
  Number.isFinite(value) ? value.toFixed(3) : '-'
const whole = (value: number): string =>
  Number.isFinite(value) ? value.toFixed(0) : '-'
const percent = (value: number): string => `${(100 * value).toFixed(1)}%`
const table = (
  head: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string>>,
): string =>
  [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '-').join(' | ')} |`,
    ...rows.map(row => `| ${row.join(' | ')} |`),
  ].join('\n')

const pairs = studyPairs()
const isRight = (pair: StudyPair) =>
  rightVariants.some(variant => variant === pair.variant)
const lengthOf = (phrase: string) =>
  studyFixture(fixtureId(phrase, 'zundamon', 'right', 'clean')).labels.phrase
    .morae
const phraseHead = phrases.map(phrase => `${lengthOf(phrase.id)} morae`)
const out: Array<string> = [
  '# The score on the fixtures',
  '',
  'Written by `npm run score:study` (scripts/score-study.ts) from fixtures/tracked/; a test checks it is current.',
  'docs/score.md says what each table means and what was chosen from it.',
  '',
  `Each of the ${voices.length} voices' clean right take of each phrase is the native, copied by each of the other ${voices.length - 1} voices in every variant and condition: ${pairs.length} pairs.`,
  'A right take is `right`, `slower`, `faster` or `uneven`; a wrong one is `fall-moved` or `fall-lost`.',
  '"Chance right beats wrong" is the chance a right take scores above a wrong one of the same phrase, where 0.5 is a coin toss; "same voice" compares each right take with the wrong takes of the same voice, native and condition only.',
  '',
]

// 1. The aligners.
out.push('## The aligners', '')
out.push(
  "The raw pitch skill (`1 - RMSE / RMS of the native`, after the clamped gain) on each aligner's path, and how far the path puts the native's labelled mora starts from the take's.",
  '',
)
const alignerRows = studyAligners.map(aligner => {
  const errors: Array<number> = []
  const skills = new Map<StudyPair, number>()
  for (const pair of pairs) {
    const path = aligner.path(pair)
    if (path === null) continue
    errors.push(...boundaryErrors(pair, path))
    skills.set(pair, pitchSkillOf(pair, path))
  }
  const chances = phrases.map(phrase => {
    const own = pairs.filter(pair => pair.phrase === phrase.id)
    return chanceAbove(
      own.filter(isRight).flatMap(pair => skills.get(pair) ?? []),
      own
        .filter(pair => isWrong(pair.variant))
        .flatMap(pair => skills.get(pair) ?? []),
    )
  })
  return [
    aligner.name,
    whole(median(errors)),
    whole(quantile(errors, 0.9)),
    ...chances.map(three),
    two(median(pairs.filter(isRight).flatMap(pair => skills.get(pair) ?? []))),
    two(
      median(
        pairs
          .filter(pair => isWrong(pair.variant))
          .flatMap(pair => skills.get(pair) ?? []),
      ),
    ),
  ]
})
out.push(
  table(
    [
      'Aligner',
      'Mora start error, median ms',
      'p90 ms',
      ...phraseHead.map(head => `Chance right beats wrong, ${head}`),
      'Right, median skill',
      'Wrong, median skill',
    ],
    alignerRows,
  ),
  '',
)

// 2. The chosen score, by condition and by voice.
const details = new Map(pairs.map(pair => [pair, scored(pair)]))
const part = (
  pair: StudyPair,
  which: 'match' | 'pitchAccent' | 'timing',
): number => {
  const score = details.get(pair)?.score
  if (score === undefined || score._tag !== 'Scored') return Number.NaN
  return which === 'match' ? score.match : score.parts[which]
}
const sameVoiceChance = (
  own: ReadonlyArray<StudyPair>,
  which: 'match' | 'pitchAccent',
): number => {
  let wins = 0
  let games = 0
  for (const right of own.filter(pair => pair.variant === 'right')) {
    for (const wrong of own.filter(
      pair =>
        isWrong(pair.variant) &&
        pair.phrase === right.phrase &&
        pair.nativeVoice === right.nativeVoice &&
        pair.takeVoice === right.takeVoice &&
        pair.condition === right.condition,
    )) {
      const a = part(right, which)
      const b = part(wrong, which)
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue
      games++
      wins += a > b ? 1 : a === b ? 0.5 : 0
    }
  }
  return wins / games
}

out.push('## The score, by length and condition', '')
out.push(
  `The chosen score: DTW on 24 log mel bands, the gain clamped to ${gainBand.least}x to ${gainBand.most}x, weights ${partWeights.pitchAccent} pitch accent and ${partWeights.timing} timing, only frames voiced in both compared. Parts and match run 0 to 1 against the provisional top.`,
  '',
)
out.push(
  table(
    [
      'Phrase',
      'Condition',
      'Chance right beats wrong, pitch accent',
      'Same voice, pitch accent',
      'Chance right beats wrong, match',
      'Same voice, match',
      'Right, median match',
      'Wrong, median match',
      "Couldn't compare",
    ],
    phrases.flatMap(phrase =>
      conditions.map(condition => {
        const own = pairs.filter(
          pair => pair.phrase === phrase.id && pair.condition === condition,
        )
        const right = own.filter(isRight)
        const wrong = own.filter(pair => isWrong(pair.variant))
        const couldNot = own.filter(
          pair => details.get(pair)?.score._tag === 'CouldNotCompare',
        )
        return [
          `${phrase.id} (${lengthOf(phrase.id)})`,
          condition,
          three(
            chanceAbove(
              right
                .map(pair => part(pair, 'pitchAccent'))
                .filter(Number.isFinite),
              wrong
                .map(pair => part(pair, 'pitchAccent'))
                .filter(Number.isFinite),
            ),
          ),
          three(sameVoiceChance(own, 'pitchAccent')),
          three(
            chanceAbove(
              right.map(pair => part(pair, 'match')).filter(Number.isFinite),
              wrong.map(pair => part(pair, 'match')).filter(Number.isFinite),
            ),
          ),
          three(sameVoiceChance(own, 'match')),
          two(median(right.map(pair => part(pair, 'match')))),
          two(median(wrong.map(pair => part(pair, 'match')))),
          `${couldNot.length} of ${own.length}`,
        ]
      }),
    ),
  ),
  '',
)

out.push("## The score, by the take's voice", '')
out.push(
  table(
    [
      'Take voice',
      ...phraseHead.map(head => `Chance right beats wrong, match, ${head}`),
      'Same voice, match, all',
      'Right, median match',
      'Wrong, median match',
    ],
    voices.map(voice => {
      const own = pairs.filter(pair => pair.takeVoice === voice.id)
      return [
        voice.id,
        ...phrases.map(phrase => {
          const mine = own.filter(pair => pair.phrase === phrase.id)
          return three(
            chanceAbove(
              mine
                .filter(isRight)
                .map(pair => part(pair, 'match'))
                .filter(Number.isFinite),
              mine
                .filter(pair => isWrong(pair.variant))
                .map(pair => part(pair, 'match'))
                .filter(Number.isFinite),
            ),
          )
        }),
        three(sameVoiceChance(own, 'match')),
        two(median(own.filter(isRight).map(pair => part(pair, 'match')))),
        two(
          median(
            own
              .filter(pair => isWrong(pair.variant))
              .map(pair => part(pair, 'match')),
          ),
        ),
      ]
    }),
  ),
  '',
)

// 3. Right takes across voices.
out.push('## Right takes across voices', '')
out.push(
  "For each native and condition, the spread (highest less lowest) of the other voices' `right` takes, and each variant's median parts over all natives and conditions.",
  '',
)
const spreads = phrases.map(phrase => {
  const spread: Array<number> = []
  for (const native of voices) {
    for (const condition of conditions) {
      const matches = pairs
        .filter(
          pair =>
            pair.phrase === phrase.id &&
            pair.nativeVoice === native.id &&
            pair.condition === condition &&
            pair.variant === 'right',
        )
        .map(pair => part(pair, 'match'))
        .filter(Number.isFinite)
      spread.push(Math.max(...matches) - Math.min(...matches))
    }
  }
  return spread
})
out.push(
  table(
    ['Phrase', 'Spread of right matches, median', 'Spread, largest'],
    phrases.map((phrase, k) => [
      phrase.id,
      two(median(spreads[k] ?? [])),
      two(Math.max(...(spreads[k] ?? []))),
    ]),
  ),
  '',
)
const variantsShown = [
  ...rightVariants,
  'mora-changed',
  ...wrongVariants,
] as const
out.push(
  table(
    [
      'Variant',
      'Match, median',
      'Pitch accent, median',
      'Timing, median',
      'Raw skill, median',
      'Tempo deviation, median',
      "Couldn't compare",
    ],
    variantsShown.map(variant => {
      const own = pairs.filter(pair => pair.variant === variant)
      return [
        variant,
        two(median(own.map(pair => part(pair, 'match')))),
        two(median(own.map(pair => part(pair, 'pitchAccent')))),
        two(median(own.map(pair => part(pair, 'timing')))),
        two(
          median(own.map(pair => details.get(pair)?.pitchSkill ?? Number.NaN)),
        ),
        three(
          median(
            own.map(pair => details.get(pair)?.tempoDeviation ?? Number.NaN),
          ),
        ),
        percent(
          own.filter(
            pair => details.get(pair)?.score._tag === 'CouldNotCompare',
          ).length / own.length,
        ),
      ]
    }),
  ),
  '',
)

// 4. The gain.
out.push('## Pitch range on audio', '')
out.push(
  "The raw skill on the chosen path with four treatments of the take's pitch range. A flat take is each clean right take held on its own median; a timid one has its movement scaled to a fifth. The rank correlation is between a clean right take's skill and how near its voice's span is to the native voice's (fixtures/voices/voices.json): 0 means the score ignores span.",
  '',
)
const chosen = studyAligners.find(aligner => aligner.name.endsWith('(chosen)'))
if (chosen === undefined) throw new Error('no chosen aligner')
const paths = new Map(pairs.map(pair => [pair, chosen.path(pair)]))
const cleanRight = pairs.filter(
  pair => pair.variant === 'right' && pair.condition === 'clean',
)
const spanCloseness = (pair: StudyPair) =>
  -Math.abs(
    Math.log2(
      (voiceSpans.get(pair.takeVoice) ?? 1) /
        (voiceSpans.get(pair.nativeVoice) ?? 1),
    ),
  )
const withinBand = cleanRight.filter(pair => spanCloseness(pair) >= -1)
const treatments = [
  { name: 'Range kept (gain 1)', band: { least: 1, most: 1 } },
  {
    name: 'Fitted gain, unbounded',
    band: { least: 0, most: Number.POSITIVE_INFINITY },
  },
  {
    name: 'Fitted gain, clamped 0.67x to 1.5x',
    band: { least: 1 / 1.5, most: 1.5 },
  },
  {
    name: 'Fitted gain, clamped 0.5x to 2x (chosen)',
    band: { least: 0.5, most: 2 },
  },
]
out.push(
  table(
    [
      'Treatment',
      ...phraseHead.map(head => `Chance right beats wrong, ${head}`),
      'Right, median',
      'Wrong, median',
      'Flat, median',
      'Timid, median',
      'Rank correlation with span closeness',
      'The same, spans within 2x',
    ],
    treatments.map(({ name, band }) => {
      const skill = (pair: StudyPair, take = pair.take) => {
        const path = paths.get(pair)
        return path == null
          ? Number.NaN
          : pitchSkillOf({ ...pair, take }, path, band)
      }
      return [
        name,
        ...phrases.map(phrase => {
          const own = pairs.filter(pair => pair.phrase === phrase.id)
          return three(
            chanceAbove(
              own.filter(isRight).map(pair => skill(pair)),
              own
                .filter(pair => isWrong(pair.variant))
                .map(pair => skill(pair)),
            ),
          )
        }),
        two(median(pairs.filter(isRight).map(pair => skill(pair)))),
        two(
          median(
            pairs
              .filter(pair => isWrong(pair.variant))
              .map(pair => skill(pair)),
          ),
        ),
        two(median(cleanRight.map(pair => skill(pair, flatTake(pair.take))))),
        two(
          median(
            cleanRight.map(pair => skill(pair, spanScaled(pair.take, 0.2))),
          ),
        ),
        two(
          rankCorrelation(
            cleanRight.map(pair => skill(pair)),
            cleanRight.map(spanCloseness),
          ),
        ),
        two(
          rankCorrelation(
            withinBand.map(pair => skill(pair)),
            withinBand.map(spanCloseness),
          ),
        ),
      ]
    }),
  ),
  '',
)

// 5. Timing.
out.push('## Timing', '')
out.push(
  "The tempo deviation (mean absolute log2 of the take's local tempo against its own overall tempo) on the chosen path and on the labelled path, and the chance an `uneven` take strays further than a `right`, `slower` or `faster` one.",
  '',
)
const labelled = studyAligners.find(aligner =>
  aligner.name.startsWith('Labelled'),
)
if (labelled === undefined) throw new Error('no labelled aligner')
out.push(
  table(
    [
      'Path',
      ...phraseHead.map(head => `Chance uneven strays further, ${head}`),
      'right',
      'slower',
      'faster',
      'uneven',
    ],
    [
      {
        name: 'DTW, chosen',
        pathOf: (pair: StudyPair) => paths.get(pair) ?? null,
      },
      { name: 'Labelled mora boundaries', pathOf: labelled.path },
    ].map(({ name, pathOf }) => {
      const deviation = (pair: StudyPair) => {
        const path = pathOf(pair)
        return path === null ? Number.NaN : tempoDeviationOf(pair, path)
      }
      return [
        name,
        ...phrases.map(phrase => {
          const own = pairs.filter(pair => pair.phrase === phrase.id)
          return three(
            chanceAbove(
              own.filter(pair => pair.variant === 'uneven').map(deviation),
              own
                .filter(
                  pair =>
                    pair.variant === 'right' ||
                    pair.variant === 'slower' ||
                    pair.variant === 'faster',
                )
                .map(deviation),
            ),
          )
        }),
        ...(['right', 'slower', 'faster', 'uneven'] as const).map(variant =>
          three(
            median(
              pairs.filter(pair => pair.variant === variant).map(deviation),
            ),
          ),
        ),
      ]
    }),
  ),
  '',
)

// 6. The anchors.
out.push("## The scale's anchors", '')
const rightClean = pairs.filter(
  pair => pair.variant === 'right' && pair.condition === 'clean',
)
const measuredTop = median(
  rightClean.map(pair => details.get(pair)?.pitchSkill ?? Number.NaN),
)
const measuredTimingTop = median(
  rightClean.map(pair => details.get(pair)?.tempoDeviation ?? Number.NaN),
)
// A take of other words: each phrase's clean right take against every
// other phrase's native, where their lengths allow a score.
const otherWords: Array<number> = []
for (const native of phrases) {
  for (const take of phrases) {
    if (take.id === native.id) continue
    for (const nativeVoice of voices) {
      for (const takeVoice of voices) {
        if (takeVoice.id === nativeVoice.id) continue
        const detail = scored({
          native: studyFixture(
            fixtureId(native.id, nativeVoice.id, 'right', 'clean'),
          ),
          take: studyFixture(
            fixtureId(take.id, takeVoice.id, 'right', 'clean'),
          ),
        })
        if (detail.score._tag === 'Scored')
          otherWords.push(detail.tempoDeviation)
      }
    }
  }
}
const measuredTimingZero = median(otherWords)
out.push(
  table(
    ['Anchor', 'What it is', 'Measured', 'In src/score/constants.ts'],
    [
      [
        '`pitchSkillTop`',
        'Median raw skill of the clean right takes: such a take scores 100%',
        three(measuredTop),
        three(pitchSkillTop),
      ],
      [
        '`timingDeviationTop`',
        'Median tempo deviation of the clean right takes: no more scores 100%',
        three(measuredTimingTop),
        three(timingDeviationTop),
      ],
      [
        '`timingDeviationZero`',
        `Median tempo deviation of a take of other words (${otherWords.length} pairs whose lengths allow a score): this much scores 0%`,
        three(measuredTimingZero),
        three(timingDeviationZero),
      ],
    ],
  ),
  '',
)

// 7. The failure gate.
out.push("## The aligner's failure gate", '')
out.push(
  "The mean distance between paired frames along the DTW path, the takes of the same words against takes of other words (each phrase's clean right takes against the other phrases' natives, where their lengths allow a score). Unrelated frames of unit variance in 24 bands stand about 6.9 apart (the square root of 48).",
  '',
)
const sameWords = pairs.map(pair => pathDistance(pair.native, pair.take))
const otherDistances: Array<number> = []
for (const native of phrases) {
  for (const take of phrases) {
    if (take.id === native.id) continue
    for (const nativeVoice of voices) {
      for (const takeVoice of voices) {
        if (takeVoice.id === nativeVoice.id) continue
        const a = studyFixture(
          fixtureId(native.id, nativeVoice.id, 'right', 'clean'),
        )
        const b = studyFixture(
          fixtureId(take.id, takeVoice.id, 'right', 'clean'),
        )
        const ratio = (b.track.to - b.track.from) / (a.track.to - a.track.from)
        if (ratio >= lengthRatioBand.least && ratio <= lengthRatioBand.most)
          otherDistances.push(pathDistance(a, b))
      }
    }
  }
}
out.push(
  table(
    [
      'Takes',
      'Pairs',
      'Lowest',
      'Median',
      '99th percentile',
      'Highest',
      `Over the gate (${dtwFailDistance})`,
    ],
    [
      ['Same words', sameWords] as const,
      ['Other words', otherDistances] as const,
    ].map(([name, distances]) => [
      name,
      `${distances.length}`,
      two(quantile(distances, 0)),
      two(median(distances)),
      two(quantile(distances, 0.99)),
      two(quantile(distances, 1)),
      `${distances.filter(distance => distance > dtwFailDistance).length}`,
    ]),
  ),
  '',
)

// 8. Octave jumps.
out.push('## Octave jumps', '')
out.push(
  "Each clean right take with one voiced frame in every `n` moved an octave up or down in turn, isolated frames as a tracker's octave errors fall, against the same take without them: how far the pitch accent part moves.",
  '',
)
const jumpRows = [50, 20, 10].map(every => {
  const moves = cleanRight.flatMap(pair => {
    const before = scoreTake(pair.native.recording, pair.take.recording)
    const f0Hz = pair.take.recording.curve.f0Hz.slice()
    let voiced = 0
    for (let f = 0; f < f0Hz.length; f++) {
      if ((f0Hz[f] ?? 0) <= 0) continue
      voiced++
      if (voiced % every === 0)
        f0Hz[f] = (f0Hz[f] ?? 0) * (voiced % (2 * every) === 0 ? 2 : 0.5)
    }
    const after = scoreTake(pair.native.recording, {
      ...pair.take.recording,
      curve: { ...pair.take.recording.curve, f0Hz },
    })
    return before._tag === 'Scored' && after._tag === 'Scored'
      ? [Math.abs(after.parts.pitchAccent - before.parts.pitchAccent)]
      : []
  })
  return [`1 in ${every}`, three(median(moves)), three(Math.max(...moves))]
})
out.push(
  table(['Frames moved', 'Change, median', 'Change, largest'], jumpRows),
  '',
)

writeFileSync(
  values.out ?? join(root, 'docs', 'score-study.md'),
  `${out.join('\n')}`,
)

// The anchors in src/score/constants.ts are these measurements to two
// places; the study refuses to pass while they have drifted apart.
const drifted = [
  ['pitchSkillTop', measuredTop, pitchSkillTop],
  ['timingDeviationTop', measuredTimingTop, timingDeviationTop],
  ['timingDeviationZero', measuredTimingZero, timingDeviationZero],
].filter(
  ([, measured, constant]) =>
    Math.abs(Number(measured) - Number(constant)) > 0.005,
)
if (drifted.length > 0) {
  for (const [name, measured] of drifted) {
    console.error(
      `${name} measures ${Number(measured).toFixed(3)}: set it in src/score/constants.ts.`,
    )
  }
  process.exitCode = 1
}

if (values.time === true) {
  // Each pair scored once more, timed, and two long readings against each
  // other.
  const started = process.hrtime.bigint()
  for (const pair of pairs)
    scoreTake(pair.native.recording, pair.take.recording)
  const each = Number(process.hrtime.bigint() - started) / 1e6 / pairs.length
  const long = (id: string) => {
    const tracked = readTracked(id)
    if (tracked.curve === null) throw new Error(id)
    return { curve: tracked.curve, features: tracked.features }
  }
  const gongitsune = long('real/gongitsune')
  const goodBye = long('real/good-bye')
  const longStarted = process.hrtime.bigint()
  const longScore = scoreTake(gongitsune, goodBye)
  console.log(
    `${pairs.length} takes of 5 to 19 morae: ${each.toFixed(2)} ms each; two 29 s readings: ${(Number(process.hrtime.bigint() - longStarted) / 1e6).toFixed(0)} ms (${longScore._tag})`,
  )
}
