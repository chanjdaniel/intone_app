# The score on the fixtures

Written by `npm run score:study` (scripts/score-study.ts) from fixtures/tracked/; a test checks it is current.
docs/score.md says what each table means and what was chosen from it.

Each of the 8 voices' clean right take of each phrase is the native, copied by each of the other 7 voices in every variant and condition: 3528 pairs.
A right take is `right`, `slower`, `faster` or `uneven`; a wrong one is `fall-moved` or `fall-lost`.
"Chance right beats wrong" is the chance a right take scores above a wrong one of the same phrase, where 0.5 is a coin toss; "same voice" compares each right take with the wrong takes of the same voice, native and condition only.

## The aligners

The raw pitch skill (`1 - RMSE / RMS of the native`, after the clamped gain) on each aligner's path, and how far the path puts the native's labelled mora starts from the take's.

| Aligner | Mora start error, median ms | p90 ms | Chance right beats wrong, 5 morae | Chance right beats wrong, 8 morae | Chance right beats wrong, 19 morae | Right, median skill | Wrong, median skill |
| - | - | - | - | - | - | - | - |
| Stretch to the same length | 48 | 149 | 0.973 | 0.838 | 0.621 | 0.42 | 0.01 |
| DTW on pitch (control) | 37 | 160 | 0.910 | 0.883 | 0.854 | 0.79 | 0.58 |
| DTW on cepstra 1-12 of the chosen bands | 16 | 75 | 0.987 | 0.808 | 0.828 | 0.58 | 0.04 |
| DTW on 24 log mel bands, 300-3400 Hz | 11 | 37 | 0.985 | 0.995 | 0.969 | 0.63 | 0.05 |
| DTW on 40 log mel bands, 100-7600 Hz | 11 | 32 | 0.993 | 1.000 | 0.960 | 0.64 | 0.06 |
| DTW on 24 log mel bands, 100-7600 Hz (chosen) | 11 | 32 | 0.993 | 1.000 | 0.968 | 0.65 | 0.07 |
| Labelled mora boundaries (ceiling) | 5 | 11 | 1.000 | 1.000 | 0.983 | 0.64 | 0.04 |

## The score, by length and condition

The chosen score: DTW on 24 log mel bands, the gain clamped to 0.5x to 2x, weights 0.6 pitch accent and 0.4 timing, only frames voiced in both compared. Parts and match run 0 to 1 against the provisional top.

| Phrase | Condition | Chance right beats wrong, pitch accent | Same voice, pitch accent | Chance right beats wrong, match | Same voice, match | Right, median match | Wrong, median match | Couldn't compare |
| - | - | - | - | - | - | - | - | - |
| ame-ga-suki (5) | clean | 1.000 | 1.000 | 0.997 | 1.000 | 0.95 | 0.40 | 3 of 392 |
| ame-ga-suki (5) | room | 0.985 | 1.000 | 0.954 | 1.000 | 0.97 | 0.40 | 5 of 392 |
| ame-ga-suki (5) | phone | 1.000 | 1.000 | 1.000 | 1.000 | 0.97 | 0.40 | 5 of 392 |
| hashi-o-watarimasu (8) | clean | 1.000 | 1.000 | 0.999 | 1.000 | 0.96 | 0.46 | 0 of 392 |
| hashi-o-watarimasu (8) | room | 1.000 | 1.000 | 0.991 | 1.000 | 0.82 | 0.39 | 5 of 392 |
| hashi-o-watarimasu (8) | phone | 1.000 | 1.000 | 0.998 | 1.000 | 0.94 | 0.46 | 0 of 392 |
| kyou-wa-eki-de (19) | clean | 0.969 | 1.000 | 0.931 | 1.000 | 0.86 | 0.58 | 1 of 392 |
| kyou-wa-eki-de (19) | room | 0.965 | 1.000 | 0.911 | 1.000 | 0.84 | 0.57 | 2 of 392 |
| kyou-wa-eki-de (19) | phone | 0.972 | 1.000 | 0.929 | 1.000 | 0.85 | 0.58 | 2 of 392 |

## The score, by the take's voice

| Take voice | Chance right beats wrong, match, 5 morae | Chance right beats wrong, match, 8 morae | Chance right beats wrong, match, 19 morae | Same voice, match, all | Right, median match | Wrong, median match |
| - | - | - | - | - | - | - |
| shikoku-metan | 1.000 | 1.000 | 0.862 | 1.000 | 0.90 | 0.41 |
| zundamon | 0.896 | 1.000 | 0.916 | 1.000 | 0.90 | 0.45 |
| kyushu-sora | 1.000 | 1.000 | 0.999 | 1.000 | 0.91 | 0.40 |
| meimei-himari | 1.000 | 0.999 | 0.940 | 1.000 | 0.92 | 0.41 |
| chugoku-usagi | 0.981 | 0.996 | 0.942 | 1.000 | 0.86 | 0.47 |
| kurono-takehiro | 1.000 | 0.994 | 0.883 | 1.000 | 0.88 | 0.40 |
| kenzaki-mesuo | 1.000 | 0.986 | 0.916 | 1.000 | 0.92 | 0.40 |
| shirakami-kotaro | 0.988 | 0.998 | 0.962 | 1.000 | 0.90 | 0.40 |

## Right takes across voices

For each native and condition, the spread (highest less lowest) of the other voices' `right` takes, and each variant's median parts over all natives and conditions.

| Phrase | Spread of right matches, median | Spread, largest |
| - | - | - |
| ame-ga-suki | 0.17 | 0.51 |
| hashi-o-watarimasu | 0.20 | 0.38 |
| kyou-wa-eki-de | 0.20 | 0.33 |

| Variant | Match, median | Pitch accent, median | Timing, median | Raw skill, median | Tempo deviation, median | Couldn't compare |
| - | - | - | - | - | - | - |
| right | 0.93 | 0.99 | 0.98 | 0.66 | 0.198 | 0.0% |
| slower | 0.93 | 0.99 | 0.98 | 0.66 | 0.201 | 0.6% |
| faster | 0.88 | 0.91 | 0.95 | 0.61 | 0.215 | 4.0% |
| uneven | 0.86 | 0.96 | 0.87 | 0.64 | 0.252 | 0.0% |
| mora-changed | 0.92 | 0.96 | 0.97 | 0.64 | 0.205 | 0.0% |
| fall-moved | 0.42 | 0.10 | 0.98 | 0.07 | 0.201 | 0.0% |
| fall-lost | 0.40 | 0.10 | 0.98 | 0.07 | 0.201 | 0.0% |

## Pitch range on audio

The raw skill on the chosen path with four treatments of the take's pitch range. A flat take is each clean right take held on its own median; a timid one has its movement scaled to a fifth. The rank correlation is between a clean right take's skill and how near its voice's span is to the native voice's (fixtures/voices/voices.json): 0 means the score ignores span.

| Treatment | Chance right beats wrong, 5 morae | Chance right beats wrong, 8 morae | Chance right beats wrong, 19 morae | Right, median | Wrong, median | Flat, median | Timid, median | Rank correlation with span closeness | The same, spans within 2x |
| - | - | - | - | - | - | - | - | - | - |
| Range kept (gain 1) | 0.917 | 0.929 | 0.853 | 0.46 | -0.14 | 0.00 | 0.19 | 0.74 | 0.72 |
| Fitted gain, unbounded | 0.994 | 1.000 | 0.968 | 0.66 | 0.09 | 0.00 | 0.68 | 0.31 | 0.27 |
| Fitted gain, clamped 0.67x to 1.5x | 0.982 | 0.999 | 0.951 | 0.61 | 0.02 | 0.00 | 0.28 | 0.60 | 0.54 |
| Fitted gain, clamped 0.5x to 2x (chosen) | 0.993 | 1.000 | 0.968 | 0.65 | 0.07 | 0.00 | 0.36 | 0.39 | 0.30 |

## Timing

The tempo deviation (mean absolute log2 of the take's local tempo against its own overall tempo) on the chosen path and on the labelled path, and the chance an `uneven` take strays further than a `right`, `slower` or `faster` one.

| Path | Chance uneven strays further, 5 morae | Chance uneven strays further, 8 morae | Chance uneven strays further, 19 morae | right | slower | faster | uneven |
| - | - | - | - | - | - | - | - |
| DTW, chosen | 0.635 | 0.509 | 0.705 | 0.198 | 0.202 | 0.219 | 0.252 |
| Labelled mora boundaries | 0.717 | 0.596 | 0.790 | 0.152 | 0.160 | 0.162 | 0.222 |

## The scale's anchors

| Anchor | What it is | Measured | In src/score/constants.ts |
| - | - | - | - |
| `pitchSkillTop` | Median raw skill of the clean right takes: such a take scores 100% | 0.666 | 0.670 |
| `timingDeviationTop` | Median tempo deviation of the clean right takes: no more scores 100% | 0.188 | 0.190 |
| `timingDeviationZero` | Median tempo deviation of a take of other words (106 pairs whose lengths allow a score): this much scores 0% | 0.662 | 0.660 |

## The aligner's failure gate

The mean distance between paired frames along the DTW path, the takes of the same words against takes of other words (each phrase's clean right takes against the other phrases' natives, where their lengths allow a score). Unrelated frames of unit variance in 24 bands stand about 6.9 apart (the square root of 48).

| Takes | Pairs | Lowest | Median | 99th percentile | Highest | Over the gate (6) |
| - | - | - | - | - | - | - |
| Same words | 3528 | 1.54 | 2.95 | 4.64 | 5.71 | 0 |
| Other words | 106 | 3.24 | 4.74 | 5.68 | 5.94 | 0 |

## Octave jumps

Each clean right take with one voiced frame in every `n` moved an octave up or down in turn, isolated frames as a tracker's octave errors fall, against the same take without them: how far the pitch accent part moves.

| Frames moved | Change, median | Change, largest |
| - | - | - |
| 1 in 50 | 0.000 | 0.041 |
| 1 in 20 | 0.000 | 0.042 |
| 1 in 10 | 0.010 | 0.239 |
