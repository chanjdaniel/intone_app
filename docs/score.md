# The score

How Intone scores a take against the native (`src/score/`), what each step was chosen from, and what the numbers do and do not show.
Every number here comes from `docs/score-study.md`, which `npm run score:study` writes from the fixtures' tracked curves and features, unless it says otherwise.

## What it is

`scoreTake(native, take)` in `src/score/score.ts` takes two `Recording`s, each a curve (`src/score/curve.ts`) and its features (`src/score/features.ts`), and returns a `Score`: `Scored` with the match, the pitch accent and timing parts, the worst stretch and `provisional: true`, or `CouldNotCompare` with its reason.
It runs anywhere: `src/score` imports nothing from Effect, Foldkit or any browser API, which lint enforces (AGENTS.md, "The folder line").
Every constant lives in `src/score/constants.ts`, each naming the section of this file or of the study it came from.
`SCORE_VERSION` is 1; bump it on any change that moves a score, so takes stored before can be scored again.

The features are 24 log mel bands per 16 ms frame, from `spectralFeatures` in `src/engine/features/spectral.ts`, on the curve's own frames: frame f covers the same 32 ms of 16 kHz audio as the curve's level.
The score normalises them per take, over the stretch it compares.

## The data

The study is the VOICEVOX fixtures (`fixtures/README.md`): three phrases of 5, 8 and 19 morae, in eight voices, each right and in wrong accents (`fall-moved`, `fall-lost`), slower, faster, unevenly timed and with one mora's sound changed, each clean, in room noise and through a phone's band.
`npm run fixtures:tracked` runs every fixture through the app's own tracker (SwiftF0, `src/engine/pitch/take.ts`) and features in Node, and writes `fixtures/tracked/`; the score's tests and the study read those, so neither needs the model.
Each voice's clean right take is the native, and each other voice's takes copy it: 3,528 pairs.

These are synthetic voices with their pitch set by rule from the accent (`fixtures/README.md`), so the numbers show how the score behaves across voices that differ in register, span, timbre and timing; they are not accuracy on a learner's speech.
Ticket 22 checks the score against a native speaker's judgement.

## The steps

1. **The pitch track** (`src/score/track.ts`): a frame is voiced at SwiftF0 confidence 0.5 or more and no more than 25 dB under the voiced frames' median level; each voiced frame becomes the median of the voiced frames within two either side, which outvotes an octave jump of a frame or two; semitones are read around the speaker's own median.
2. **The speech:** from the first run of three voiced frames to the end of the last, reaching up to 300 ms past either end over sound that stands 10 dB clear of the recording's quietest tenth.
3. **Couldn't compare:** a take voiced for under 40% of the native's voiced frames (`TooQuiet` when its loud end is under -50 dBFS, else `TooLittleVoiced`), or whose speech is under half or over twice the native's (`LengthMismatch`).
4. **The alignment** (`src/score/align.ts`): each recording's features normalised to mean 0 and variance 1 per band over its speech, then DTW between them in a band of 20% of the longer recording (at least 250 ms) around the stretched diagonal, falling back to stretching the take evenly when DTW fails.
5. **The pitch part** (`src/score/compare.ts`): each native frame takes the mean pitch of the voiced take frames the path pairs it with; over the frames voiced in both, both are centred, one gain is fitted to the take by least squares and clamped to 0.5x to 2x, and the skill is `1 - RMSE / RMS of the native's centred pitch`, which is 1 for a match and 0 for one held note.
   The part is the skill over the provisional top, 0.67, clamped to 0 to 1.
6. **The timing part:** over each 200 ms of the native, the take frames per native frame along the path, against the take's own overall tempo, as the mean absolute log2 ratio; up to 0.19 scores 100% and 0.66 scores 0%.
7. **The match:** 0.6 x pitch accent + 0.4 x timing.
8. **The worst stretch:** the 400 ms of the native with the lowest skill over its own frames (with the whole take's gain), and the take frames the path pairs with them, in seconds from each recording's start.

## The aligner

The study compares seven ways of lining a take up, all scored by the same pitch part ("The aligners" in the study):

- **Stretching** to the same length lines the morae up within 48 ms at the median, 149 ms at the 90th percentile, and a right take beats a wrong one 0.97, 0.84 and 0.62 of the time at 5, 8 and 19 morae: the longer the phrase, the further its morae drift from an even stretch.
- **DTW on pitch**, the control, does what the report found on synthetic curves: it warps a wrong accent onto the right one, so wrong takes score a median skill of 0.58 against 0.07 with the chosen aligner, and it separates right from wrong only 0.91, 0.88 and 0.85 of the time.
- **DTW on cepstra** (the usual MFCCs) lines morae up within 16 ms at the median but 75 ms at the 90th percentile, and separates 8 and 19 morae only 0.81 and 0.83 of the time.
- **DTW on log mel bands** lines them up within 11 ms at the median and 32 to 37 ms at the 90th percentile, with 24 or 40 bands, over 100 to 7600 Hz or the telephone band alone.
- **The labelled mora boundaries**, the ceiling, line up within 5 and 11 ms and separate 1.000, 1.000 and 0.983 of the time.

The chosen aligner is DTW on 24 log mel bands over 100 to 7600 Hz: it separates right from wrong 0.993, 1.000 and 0.968 of the time, within 0.02 of the labelled boundaries.
Its wrong takes keep a median skill of 0.07, near the labelled boundaries' 0.04, so the bands do not carry enough pitch to warp one accent onto another.
40 bands did no better, and the telephone band alone did slightly worse at 5 and 8 morae (0.985 and 0.995).
The band's width changed nothing measurable from 10% up (measured on this branch with the band at 5%, 10%, 20%, 35% and 100% before the speech's reach was added); 20% leaves room for a learner's hesitation, and the cost is small at a line's length.
Weighting DTW's diagonal steps double, the usual unbiased step pattern, lined the morae up worse (13 ms median, 51 ms at the 90th percentile, measured the same way), so each step costs one distance.

The aligner is behind the `Aligner` interface, which takes two `Features` and answers a path or null; a speech model's frames go through it too, put on the curve's frames by `onCurveFrames` (`src/score/features.ts`).
Whisper-base's encoder and WavLM line the fixtures up a little better than the bands (27 ms at the 90th percentile, 0.980 at 19 morae), but none of them is on the device for a take and each costs seconds a take, so the bands stay (`docs/sounds.md`, "The aligner, answered").
`chosenAligner` falls back to `stretchAligner` when DTW answers null: for features that cannot be compared (different dimensions or frame rates, under two frames), or a path whose paired frames stand more than 6 apart on average, which no fixture pair reaches (takes of the same words reach 5.71 at most, takes of other words 5.94, and unrelated frames of 24 normalised bands stand about 6.9 apart).
So on the fixtures the fallback never runs; it is there for a recording DTW cannot use.

## The chance a right take beats a wrong one

On the pitch accent part, by phrase and condition ("The score, by length and condition" in the study):

| Morae | Clean | Room  | Phone |
| ----- | ----- | ----- | ----- |
| 5     | 1.000 | 0.985 | 1.000 |
| 8     | 1.000 | 1.000 | 1.000 |
| 19    | 0.969 | 0.965 | 0.972 |

Within the same take voice, native and condition, every right take scores above both wrong takes, in every phrase and condition, on the pitch accent part and on the match: that holds 1.000, and `tests/score/fixtures.test.ts` checks it pair by pair.
The pooled chance is below 1 because voices differ: a right take in one voice can score below a wrong one in another.
By take voice, on the match, it runs from 0.90 to 1.00 at 5 morae, 0.99 to 1.00 at 8, and 0.86 to 1.00 at 19 ("The score, by the take's voice").
One wrong fall in 19 morae is the hardest case, as the report expected: the rest of the phrase still matches.

## Across voices

For each native and condition, the other voices' right takes score within 0.17, 0.20 and 0.20 of each other at the median, and within 0.51, 0.38 and 0.33 at worst ("Right takes across voices").
The widest spreads are pairs of voices whose own pitch patterns differ, such as 白上虎太郎 copying 中国うさぎ on the shortest phrase, whose pitch accent part is 0.19 to 0.21 in every condition.
A test holds the spread under 0.55 at worst and 0.25 at the median.
Faster takes score a little lower on pitch accent than takes at the voice's own pace (0.91 median against 0.99).
A take with one mora's sound changed and its accent kept scores as a right take does (0.92 against 0.93 median match), so the pitch part ignores sounds, as it should; no speech model measured gave a sounds part that passes its bar (`docs/sounds.md`), so the match has none.

## Pitch range

The report's synthetic study found that one fitted gain, clamped to 0.5x to 2x, makes the score blind to the take's span inside the band, while keeping a flat take near zero.
On audio ("Pitch range on audio"), with the fixture voices' spans running from 5.3 to 11.4 semitones:

- the clamped gain separates right from wrong as well as an unbounded gain (0.993, 1.000 and 0.968 against 0.994, 1.000 and 0.968), and far better than keeping the range (0.917, 0.929 and 0.853);
- a flat take scores a median skill of 0.00 with every treatment, and a take that barely moves (its movement a fifth of a right take's) keeps 0.36, where the unbounded gain scales it up to 0.68;
- the rank correlation between a right take's skill and how near its voice's span is to the native's is 0.39 with the clamped gain, 0.74 with the range kept and 0.31 unbounded, and 0.30, 0.72 and 0.27 among voices whose spans are within 2x of each other.

So on audio the clamp is span-blind inside its band as far as an unbounded gain is: what correlation remains inside the band (0.27 to 0.30) is there with no clamp at all, and comes from voices with similar spans being alike in other ways, not from the gain.
Outside the band the clamp works as meant, keeping a take that barely moves from scoring as a full one.
The property tests check the band directly: scaling a take's span by 0.5x to 2x moves its skill by under 0.01, and a fifth of the span lowers it by over 0.3.

## Gaps

Only frames voiced in both recordings are compared, so missing pitch is never an error: a devoiced mora, a creak below the confidence gate, a breath.
The painter still bridges gaps up to 150 ms for the eye (`src/engine/draw/curve.ts`), but the score does not: a bridged gap across the native's fall counts the bridge's straight line as the take's pitch, and costs a perfect copy 0.26 of skill in the property test.
Bridging in the score would have lifted the 19-mora phrase's chance of a right take beating a wrong one from 0.968 to 0.980 (measured on this branch with gaps up to 150 ms bridged), which the spec's rule outweighs.
The octave filter is one-sided beside a gap, so a frame next to a gap can move by the tracker's jitter; a perfect copy with a gap where the pitch holds keeps a skill above 0.98, and one with a gap across the fall above 0.85.

The level gate (25 dB under the voiced median) drops none of the fixtures' own voiced frames, which sit at most 13 dB under it, and made no difference at 15, 25 or 40 dB: no fixture has a voice behind the speaker, so the gate is a guess at that.

## The speech

The speech span matters because DTW pins the first and last frames of each recording together.
From the first run of voice to the last alone, a voice whose last mora is short and quiet (ずんだもん's き in 雨が好き) lost it to room noise, its right take was pinned short, and in the same voice and condition it scored below its wrong takes: the same-voice chance on the match was 0.907 at 5 morae in room noise.
Reaching past the voice over sound 6 dB clear of the recording's quietest tenth let room noise in; 10 dB, up to 300 ms, put every right take above its wrong ones in every condition (measured on this branch with each setting).

## Timing

The timing part reads how far the take's local tempo strays from its own overall tempo, so a take said slower or faster throughout keeps it: on the fixtures the median timing part is 0.98 for right takes, 0.98 slower and 0.95 faster, and a property test holds a uniformly paced synthetic take above 0.95 and within 0.05 of the same take at the native's pace.

It is the weak part.
The chance that an `uneven` take (a third of its morae held half again as long, a quarter clipped to six tenths) strays further than a steady one is 0.64, 0.51 and 0.71 at 5, 8 and 19 morae on the chosen path, and 0.72, 0.60 and 0.79 even on the labelled boundaries ("Timing"): the eight voices' own timing differs about as much as the uneven variant's, so across voices timing barely tells them apart.
The 200 ms window read the uneven takes best of 0.1 to 0.5 s (measured on this branch with the window at 6, 12, 19, 25 and 31 frames, before the speech's reach was added).
A reading of the path's slope symmetric in the two recordings, and the root mean square or 90th percentile of the deviation in place of its mean, did about as well or worse.

## Combining the parts

The match is the spec's starting weights, 0.6 pitch accent and 0.4 timing, kept for ticket 22 to fit to a native speaker's ratings.
The timing part does not see accent, so a wrong accent said in time keeps about 0.4 of the match (median 0.39 to 0.58 by phrase and condition), and so does a flat take: its pitch accent part is near 0 at any length, but its timing part is not.
The score card shows the parts beside the headline, which tells such a take apart (a fall moved by one mora in 玄野武宏's voice reads 40% with its pitch accent at 0%); ticket 22 decides whether the weights, or a headline that needs the pitch part, should change.

## The worst stretch

On every clean wrong fixture (336 takes), the worst stretch overlaps the accent phrase the wrong take changed by more than 100 ms (`tests/score/fixtures.test.ts`).
A property test checks it is mapped through the path: on a take said half again as slowly, the take's stretch is the slower take's frames.

## Couldn't compare

On the fixtures 23 of the 3,528 takes (0.65%) could not be compared, all for length: 20 faster takes and 3 slower ones, where a fast voice speaking faster copies a slow one, or the other way about, and the speech is over twice or under half the native's.
No right take at its own pace is refused, and no take is refused as too little voiced or too quiet; the property tests make each reason happen on purpose.

## Octave jumps

With one voiced frame in 50 moved an octave up or down, the pitch accent part moves by 0.041 at most; one in 20, by 0.042; one in 10, by 0.239 at most and 0.010 at the median ("Octave jumps").
Tests hold the fixtures under 0.05 at one in 50 and synthetic takes under 0.05 of skill at one in 20.

## The top of the scale

The raw skill of a right take is well under 1, since two voices never move exactly alike: the clean right takes' median is 0.666.
Until ticket 22 has a native speaker's own second take to anchor 100%, that median does: a right take copying another voice as well as the fixture voices copy each other scores 100%, which half of them reach.
The timing part's scale is anchored the same way, with a take of other words, whose path follows nothing, as 0%.
The score says `provisional: true` until then.
`npm run score:study` fails while an anchor in `src/score/constants.ts` differs from what it measures by more than 0.005.

## Stars

A line earns stars from its takes (`src/score/stars.ts`): one for a guided take that reaches the clip's threshold, two for one that beats it, three for a blind take that reaches it; it keeps the most any take earned, and a take that could not be compared earns none and costs none.
The thresholds are shares of the clip's top, in `src/score/constants.ts`: reached at 0.75 and beaten at 0.9 of it, read at the whole percent the app shows.
Every clip's top is the provisional top of the scale, a match of 1, until ticket 22 measures a clip's from a native speaker's own second take.
On the fixtures 89% of the clean right takes reach the threshold as guided takes and 60% beat it, while 3% of the wrong takes reach it, all of them in the 19-mora phrase, and none beats it ("Stars").
Stars are not part of the score, so changing a threshold bumps no `SCORE_VERSION`; a line's stars are worked out from its kept takes each time they are shown, so a threshold tuned or a take scored again moves them.

## Returns

Once a line has had a blind take, it comes back for another on a widening schedule (`src/score/returns.ts`), worked out from its blind takes alone, earliest first, so a guided take is never its return.
A blind take made on or after the day the line is due is its return: one that reaches the threshold, read as stars read it, brings the line back after the next of `returnStepDays` (1, 3, 7, 14 and 30 days, then 30 from then on), and one that misses brings it back `returnAfterMissDays` (1) later and starts the steps again.
A line's first blind take, reached or not, brings it back the next day.
A blind take made before the line is due moves the date only when it misses, so several in one sitting cannot skip the steps; one that could not be compared moves nothing, as it costs no star.
A line stays due from its day on, however long after, with nothing lost and no word of lateness, and its next step is reckoned from the day the return is made.
The steps are the widening intervals of spaced practice the ticket gives; no data of the app's own has tuned them yet.
Days are the learner's own, as each take keeps them, so travel moves no return.
Like stars, a line's return is worked out from its kept takes of the line as it is now whenever it is shown, never stored apart: a take scored again, a span changed (its returns start again), a restore or a deletion moves it with the takes, and a backup carries it with them.

## Time to score

Scoring the study's 3,528 takes of 5 to 19 morae takes 0.23 to 0.48 ms a take in Node 24.22.1 on Daniel's machine (11 cores, at load averages of 2 to 9), and two 29 s readings against each other 36 to 60 ms (`npm run score:study -- --time`).
In the app the Scorer runs it on the main thread when a take ends; `docs/latency.md` gives the time from stop to the score on the screen.

## Changing the score

- After a change to the tracker or the features, run `npm run fixtures:tracked`, then `npm run score:study`.
- After a change to the score, run `npm run score:study`, set any anchor it names, and bump `SCORE_VERSION` if any score moved.
- `tests/scripts/tracked-fixtures.test.ts` and `tests/scripts/score-study.test.ts` fail until both outputs are current.
