import { Schema } from 'effect'

// The starter set's records (docs/starter-set.md): the source list
// `starter/lines.json`, edited by hand and by the native review; the pack
// `scripts/starter-pack.ts` writes from it, `starter/pack/levels.json`,
// which the app imports; and the review's export, which the review page
// (src/app/review/) saves and the script applies. One Schema for each, so
// the page, the app and the script read the same shapes.

// The four Tokyo accent patterns, and the level of pairs and of phrases
// after them, as the 2023 slides' lessons ran.
export const StarterLevelKind = Schema.Literals([
  'Heiban',
  'Atamadaka',
  'Nakadaka',
  'Odaka',
  'Pairs',
  'Phrases',
])
export type StarterLevelKind = typeof StarterLevelKind.Type

const AccentType = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

// The licences a bundled recording may carry, each as its source names
// it: a Commons file under CC0, CC BY or CC BY-SA, as Commons' own licence
// metadata gives it per file; a LibriVox reading under CC0 or in the
// public domain; or a VOICEVOX voice under its own terms. Anything else is
// refused, so it can be neither committed nor bundled.
export const CommonsLicence = Schema.Literals([
  'CC0',
  'CC BY 2.0',
  'CC BY 2.5',
  'CC BY 3.0',
  'CC BY 4.0',
  'CC BY-SA 2.0',
  'CC BY-SA 2.5',
  'CC BY-SA 3.0',
  'CC BY-SA 4.0',
])
export type CommonsLicence = typeof CommonsLicence.Type

export const LibriVoxLicence = Schema.Literals(['CC0', 'Public domain'])

// Whether a licence asks for adaptations, such as a recording cut or
// resampled, to stay under the same licence.
export const isShareAlike = (licence: string): boolean =>
  licence.startsWith('CC BY-SA')

const Sha256 = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/))
const HttpsUrl = Schema.String.check(Schema.isPattern(/^https:\/\/\S+$/))

// A file downloaded from its source, pinned by its size and SHA-256, so
// a changed upload is refused rather than bundled.
const Download = {
  // Its page, where its licence and author are stated.
  page: HttpsUrl,
  // The file itself.
  url: HttpsUrl,
  bytes: Schema.Int,
  sha256: Sha256,
  author: Schema.String.check(Schema.isMinLength(1)),
}

export const CommonsRecording = Schema.Struct({
  kind: Schema.Literal('Commons'),
  // The file's title on Commons, `File:...`.
  file: Schema.String.check(Schema.isStartingWith('File:')),
  ...Download,
  licence: CommonsLicence,
  licenceUrl: HttpsUrl,
})
export type CommonsRecording = typeof CommonsRecording.Type

export const LibriVoxRecording = Schema.Struct({
  kind: Schema.Literal('LibriVox'),
  ...Download,
  licence: LibriVoxLicence,
  // The stretch of the reading the line is, in seconds.
  from: Schema.Finite,
  to: Schema.Finite,
})
export type LibriVoxRecording = typeof LibriVoxRecording.Type

// The VOICEVOX voices whose terms are recorded in fixtures/README.md,
// read at source on 2026-11-09, and allow this use with a credit.
export const VoicevoxVoiceId = Schema.Literals([
  'meimei-himari',
  'kurono-takehiro',
])
export type VoicevoxVoiceId = typeof VoicevoxVoiceId.Type

// Synthesised by VOICEVOX CORE from the line's kana, its pitch set from
// the stated accent, so the recording follows the list.
export const VoicevoxRecording = Schema.Struct({
  kind: Schema.Literal('Voicevox'),
  voice: VoicevoxVoiceId,
})
export type VoicevoxRecording = typeof VoicevoxRecording.Type

export const StarterRecording = Schema.Union([
  CommonsRecording,
  LibriVoxRecording,
  VoicevoxRecording,
])
export type StarterRecording = typeof StarterRecording.Type

// What the native review said of a line (ticket 25), or that it has not
// been heard yet.
export const ReviewVerdict = Schema.Literals(['accept', 'reject', 'correct'])
export type ReviewVerdict = typeof ReviewVerdict.Type

export const LineReview = Schema.Union([
  Schema.Struct({ verdict: Schema.Literal('unreviewed') }),
  Schema.Struct({
    verdict: ReviewVerdict,
    reviewedOn: Schema.String,
    reviewer: Schema.optionalKey(Schema.String),
    // A corrected accent type, and the one the list stated before it.
    accentType: Schema.optionalKey(AccentType),
    statedBefore: Schema.optionalKey(AccentType),
    note: Schema.optionalKey(Schema.String),
  }),
])
export type LineReview = typeof LineReview.Type

// One word of a line, an accent phrase of its own, with the particle
// that follows it. `unidic` and `wiktionary` are what each source gives
// for the word as a dictionary entry, written by the script's
// `--accents`; a word said by a rule, such as a ます form, which falls on
// its ま whatever the verb's own accent, names the rule instead.
export const StarterWord = Schema.Struct({
  text: Schema.String,
  kana: Schema.String,
  accentType: AccentType,
  particle: Schema.optionalKey(Schema.String),
  unidic: Schema.optionalKey(Schema.Array(AccentType)),
  wiktionary: Schema.optionalKey(Schema.Array(AccentType)),
  byRule: Schema.optionalKey(Schema.String),
})
export type StarterWord = typeof StarterWord.Type

export const StarterLevel = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^starter-[a-z]+$/)),
  kind: StarterLevelKind,
  name: Schema.String,
  // What the level practises, in a sentence.
  about: Schema.String,
})
export type StarterLevel = typeof StarterLevel.Type

export const StarterListLine = Schema.Struct({
  // Unique in the set, and never changed, since takes are kept by it.
  id: Schema.String.check(Schema.isPattern(/^[a-z0-9-]+$/)),
  level: Schema.String,
  // One of the six examples of the 2023 slides the list starts from.
  seed: Schema.optionalKey(Schema.Boolean),
  text: Schema.String,
  kana: Schema.String,
  words: Schema.Array(StarterWord).check(Schema.isMinLength(1)),
  // Where the sources disagree with each other or with the stated
  // accent, written by the script from `unidic` and `wiktionary`.
  flag: Schema.optionalKey(Schema.String),
  // Anything else the reviewer should know, written by hand.
  note: Schema.optionalKey(Schema.String),
  recording: StarterRecording,
  review: LineReview,
})
export type StarterListLine = typeof StarterListLine.Type

export const StarterList = Schema.Struct({
  version: Schema.Literal(1),
  levels: Schema.Array(StarterLevel),
  lines: Schema.Array(StarterListLine),
})
export type StarterList = typeof StarterList.Type

// A recording as the app credits it.
export const StarterCredit = Schema.Struct({
  // Who is speaking, or which voice.
  author: Schema.String,
  // Where it came from: its page, or the voice's terms.
  source: Schema.Literals(['Wikimedia Commons', 'LibriVox', 'VOICEVOX']),
  page: HttpsUrl,
  licence: Schema.Union([
    CommonsLicence,
    LibriVoxLicence,
    Schema.String.check(Schema.isPattern(/^VOICEVOX:\S+ terms of use$/)),
  ]),
  licenceUrl: HttpsUrl,
  // What was done to it, which a CC BY or CC BY-SA credit names.
  changes: Schema.String,
})
export type StarterCredit = typeof StarterCredit.Type

export const StarterPackLine = Schema.Struct({
  id: Schema.String,
  seed: Schema.Boolean,
  text: Schema.String,
  kana: Schema.String,
  morae: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
  // The accent type of its first word, the one its particle follows.
  accentType: AccentType,
  particle: Schema.NullOr(Schema.String),
  words: Schema.Array(
    Schema.Struct({
      text: Schema.String,
      kana: Schema.String,
      accentType: AccentType,
      particle: Schema.NullOr(Schema.String),
      // The rule its accent is stated by, when it is not looked up.
      byRule: Schema.NullOr(Schema.String),
    }),
  ),
  flag: Schema.NullOr(Schema.String),
  note: Schema.NullOr(Schema.String),
  // Its file under starter/pack/, and how long and what it is.
  audio: Schema.String.check(Schema.isPattern(/^audio\/[a-z0-9-]+\.wav$/)),
  seconds: Schema.Finite,
  sha256: Sha256,
  // What the file was made from, as a key: the script remakes a line
  // whose key has changed, and keeps its file otherwise.
  made: Schema.String,
  credit: StarterCredit,
  review: LineReview,
})
export type StarterPackLine = typeof StarterPackLine.Type

export const StarterPack = Schema.Struct({
  version: Schema.Literal(1),
  levels: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      kind: StarterLevelKind,
      name: Schema.String,
      about: Schema.String,
      lines: Schema.Array(StarterPackLine),
    }),
  ),
})
export type StarterPack = typeof StarterPack.Type

// The review's export, which the review page saves as one file and
// `scripts/starter-pack.ts --apply` writes into the list.
export const ReviewExportVerdict = Schema.Struct({
  lineId: Schema.String,
  verdict: ReviewVerdict,
  accentType: Schema.optionalKey(AccentType),
  note: Schema.optionalKey(Schema.String),
})
export type ReviewExportVerdict = typeof ReviewExportVerdict.Type

export const ReviewExport = Schema.Struct({
  reviewedOn: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)),
  reviewer: Schema.optionalKey(Schema.String),
  verdicts: Schema.Array(ReviewExportVerdict),
})
export type ReviewExport = typeof ReviewExport.Type
