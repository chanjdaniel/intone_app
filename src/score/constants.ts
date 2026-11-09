// Every constant the score and the curve rest on, in one place, each with
// the data it came from (spec, "The score's interface"). docs/score.md
// gives the numbers behind each, measured on the VOICEVOX fixtures by
// scripts/score-study.ts (docs/score-study.md); ticket 22 tunes them with
// a native speaker.

// Bumped on any change of what a score means, so a take scored before can
// be scored again.
export const SCORE_VERSION = 1

// A frame counts as voiced from this confidence up. SwiftF0 calibrates its
// confidence so that 0.5 is its own voicing threshold (SwiftF0 0.3.0,
// `swift_f0/core.py`, `PitchResult.confidence`).
export const confidenceGate = 0.5

// A voiced frame more than this under the voiced frames' median level is
// a gap: a quieter voice in the room behind the speaker. The fixtures'
// own voiced frames sit at most 13 dB under their median, so this drops
// none of them; no fixture has a voice behind the speaker yet, so it is
// a guess at that (docs/score.md, "Gaps").
export const levelGateDb = 25

// Each voiced frame becomes the median of the voiced frames this wide
// around it, so an octave jump of a frame or two is outvoted
// (docs/score-study.md, "Octave jumps").
export const octaveFilterFrames = 5

// A run of voice this long (48 ms) starts or ends the speech, as the
// curve's onset does (src/engine/pitch/onset.ts).
export const voiceRunFrames = 3

// Only frames voiced in both the native and the take are compared: a
// gap, however short, is never bridged in the score, so missing pitch is
// never an error (spec, "The score's interface"). The painter bridges
// short gaps for the eye (src/engine/draw/curve.ts, `bridgedGapFrames`);
// docs/score.md, "Gaps", gives what bridging them in the score would have
// changed.

// The speech reaches out from the first and last runs of voice, at most
// `speechSpanReachSeconds`, to the furthest run of frames at least
// `speechOverNoiseDb` over the recording's quietest tenth and within
// `speechSpanLevelDb` of the voice's median level: a voiceless consonant,
// or a weak last mora the tracker lost in noise (docs/score.md, "The
// speech").
export const speechSpanReachSeconds = 0.3
export const speechOverNoiseDb = 10
export const speechSpanLevelDb = 30

// One gain per take, fitted to the native's pitch and clamped to this
// band, takes the take's pitch range out (report section 3); the band's
// edges are provisional (docs/score.md, "Pitch range").
export const gainBand = { least: 0.5, most: 2 } as const

// The headline is the parts' weighted mean: the spec's starting values,
// kept (docs/score.md, "Combining the parts"). Ticket 22 fits them.
export const partWeights = { pitchAccent: 0.6, timing: 0.4 } as const

// Couldn't compare: a take voiced for under this share of the native's
// voiced frames, or whose speech is outside this band of the native's
// length (spec, starting values; docs/score.md, "Couldn't compare").
export const leastVoicedShare = 0.4
export const lengthRatioBand = { least: 0.5, most: 2 } as const

// A take too little voiced whose loud end (its 95th percentile level) is
// under this was too quiet, rather than unvoiced: the take's own
// too-quiet peak (src/engine/pitch/take.ts, `tooQuietPeakDb`).
export const tooQuietLevelDb = -50

// The aligner's band either side of the stretched diagonal: this share of
// the longer recording, and at least this many seconds (docs/score.md,
// "The aligner").
export const dtwBandShare = 0.2
export const dtwBandSeconds = 0.25

// A DTW path whose paired frames stand further apart than this on average
// matched nothing, and the score falls back to stretching the take
// (docs/score-study.md, "The aligner's failure gate").
export const dtwFailDistance = 6

// The timing part reads the take's local tempo over this much of the
// native (docs/score.md, "Timing").
export const timingWindowSeconds = 0.2

// The worst stretch's length (spec, Glossary).
export const worstStretchSeconds = 0.4

// The provisional top of the scale, until ticket 22 anchors it on a
// native speaker's own second take: the median raw pitch skill of the
// fixtures' clean right takes, against another voice's right take as the
// native, scores 100% (docs/score-study.md, "The scale's anchors").
export const pitchSkillTop = 0.67

// The timing part's scale: a tempo deviation up to the fixtures' clean
// right takes' median scores 100%, and that of a take of other words, a
// path that follows nothing, 0% (docs/score-study.md, "The scale's
// anchors").
export const timingDeviationTop = 0.19
export const timingDeviationZero = 0.66

// Stars (report section 5): a guided take that reaches the clip's
// threshold earns a line one star, one that beats it two, and a blind
// take that reaches it three. Both thresholds are shares of the clip's
// top, the match a take copying the clip as well as the fixture voices
// copy each other scores; until ticket 22 measures a native speaker's
// own second take of a clip, every clip's top is the provisional top of
// the scale, a match of 1. The fixtures' clean right takes have a median
// match of 0.93, their wrong ones 0.40 to 0.58 by phrase
// (docs/score-study.md, "The score, by length and condition"), so
// reaching sits between the two and beating near the right takes'
// median (docs/score-study.md, "Stars").
export const provisionalClipTop = 1
export const starReachShare = 0.75
export const starBeatShare = 0.9
