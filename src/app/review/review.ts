import { Array, Option, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { ReviewDraft } from '../../services/review-store'
import {
  type ReviewExport,
  type ReviewExportVerdict,
  type ReviewVerdict,
  type StarterPackLine,
} from '../../services/starter-records'

// The starter review (ticket 25), as the Model holds it: the verdicts
// given so far, kept on the device after each change; the one line
// playing; and what came of the last export. /review is reached only by
// its address and never offered in normal use (docs/starter-set.md).

// Whether the verdicts are being written to the device. A change made
// while a write is under way is written once that one is done, so the
// device always ends with the latest verdicts and writes never cross.
export const ReviewSave = defineTaggedUnion({
  Kept: {},
  Saving: { again: Schema.Boolean },
  Failed: { reason: Schema.String },
})
export type ReviewSave = typeof ReviewSave.Type

export const ReviewPlay = defineTaggedUnion({
  Stopped: {},
  Playing: { lineId: Schema.String, playNumber: Schema.Finite },
})
export type ReviewPlay = typeof ReviewPlay.Type

export const ReviewExported = defineTaggedUnion({
  Nothing: {},
  Saved: { fileName: Schema.String, verdicts: Schema.Finite },
  Refused: { reason: Schema.String },
})
export type ReviewExported = typeof ReviewExported.Type

export const ReviewPage = defineTaggedUnion({
  NotLoaded: {},
  Loading: {},
  Ready: {
    draft: ReviewDraft,
    save: ReviewSave,
    play: ReviewPlay,
    playsStarted: Schema.Finite,
    exported: ReviewExported,
    // Why the last line played did not, until another plays.
    maybePlayFailure: Schema.Option(Schema.String),
  },
  Failed: { reason: Schema.String },
})
export type ReviewPage = typeof ReviewPage.Type

export type ReviewReady = Extract<ReviewPage, { _tag: 'Ready' }>

// The pattern an accent type names in a word of `morae` morae.
export const patternOf = (accentType: number, morae: number): string =>
  accentType === 0
    ? 'heiban'
    : accentType === 1
      ? 'atamadaka'
      : accentType === morae
        ? 'odaka'
        : 'nakadaka'

export const verdictOf = (
  draft: ReviewDraft,
  lineId: string,
): Option.Option<ReviewExportVerdict> =>
  Array.findFirst(draft.verdicts, verdict => verdict.lineId === lineId)

// The draft with `lineId`'s verdict made over by `change`, or taken out
// when it gives none, in the place it had.
export const withVerdict = (
  draft: ReviewDraft,
  lineId: string,
  change: (
    before: Option.Option<ReviewExportVerdict>,
  ) => Option.Option<ReviewExportVerdict>,
): ReviewDraft => {
  const before = verdictOf(draft, lineId)
  const after = change(before)
  const index = draft.verdicts.findIndex(verdict => verdict.lineId === lineId)
  const rest = draft.verdicts.filter(verdict => verdict.lineId !== lineId)
  return {
    ...draft,
    verdicts: Option.match(after, {
      onNone: () => rest,
      onSome: verdict =>
        index === -1
          ? [...rest, verdict]
          : [...rest.slice(0, index), verdict, ...rest.slice(index)],
    }),
  }
}

// A verdict given, kept with the line's note; a changed accent keeps
// its type only while the verdict is to change it.
export const givenVerdict = (
  before: Option.Option<ReviewExportVerdict>,
  lineId: string,
  verdict: ReviewVerdict,
): ReviewExportVerdict => {
  const note = Option.flatMap(before, found => Option.fromNullishOr(found.note))
  const accentType = Option.flatMap(before, found =>
    Option.fromNullishOr(found.accentType),
  )
  return {
    lineId,
    verdict,
    ...(verdict === 'correct' && Option.isSome(accentType)
      ? { accentType: accentType.value }
      : {}),
    ...(Option.isSome(note) ? { note: note.value } : {}),
  }
}

// The export, the verdicts in the starter set's order, or why it cannot
// be made yet.
export const reviewExportOf = (
  draft: ReviewDraft,
  lines: ReadonlyArray<StarterPackLine>,
  reviewedOn: string,
): ReviewExport | string => {
  const ordered = lines.flatMap(line =>
    Option.toArray(verdictOf(draft, line.id)).map(verdict => ({
      line,
      verdict,
    })),
  )
  if (ordered.length === 0) {
    return 'No line has a verdict yet.'
  }
  const unchosen = ordered.filter(
    ({ verdict }) =>
      verdict.verdict === 'correct' && verdict.accentType === undefined,
  )
  if (unchosen.length > 0) {
    return `Choose the accent type for ${unchosen.map(({ line }) => line.text).join(', ')}.`
  }
  const reviewer = draft.reviewer.trim()
  return {
    reviewedOn,
    ...(reviewer === '' ? {} : { reviewer }),
    verdicts: ordered.map(({ verdict }) => {
      const note = verdict.note?.trim() ?? ''
      return {
        lineId: verdict.lineId,
        verdict: verdict.verdict,
        ...(verdict.accentType === undefined
          ? {}
          : { accentType: verdict.accentType }),
        ...(note === '' ? {} : { note }),
      }
    }),
  }
}

export const reviewFileName = (day: string): string =>
  `intone-starter-review-${day}.json`
