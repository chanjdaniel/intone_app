import { Option } from 'effect'
import type { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import type { ReviewDraft } from '../../services/review-store'
import type { ReviewVerdict } from '../../services/starter-records'
import type { Message } from '../message'
import type { Model } from '../model'
import type { AppResourceServices } from '../resources'
import { ExportReview, LoadReview, SaveReview } from './commands'
import {
  ReviewExported,
  ReviewPage,
  ReviewPlay,
  type ReviewReady,
  ReviewSave,
  givenVerdict,
  withVerdict,
} from './review'

// The review page's transitions. It reads the verdicts kept on the
// device when it opens, and keeps them again after each change, one
// write at a time; a line plays only while the Model says so.

type ReviewUpdate = Update.Return<Model, Message, AppResourceServices>

const unchanged = (model: Model): ReviewUpdate => ({ model })

const ready = (
  model: Model,
  change: (page: ReviewReady) => ReviewUpdate,
): ReviewUpdate =>
  model.review._tag === 'Ready' ? change(model.review) : unchanged(model)

const withPage = (model: Model, page: ReviewPage): Model =>
  modifyFields(model, { review: () => page })

export const openedReview = (model: Model): ReviewUpdate =>
  model.review._tag === 'Ready'
    ? unchanged(model)
    : { model: withPage(model, ReviewPage.Loading()), commands: [LoadReview()] }

export const succeededLoadReview = (
  model: Model,
  draft: ReviewDraft,
): ReviewUpdate =>
  model.review._tag === 'Loading'
    ? {
        model: withPage(
          model,
          ReviewPage.Ready({
            draft,
            save: ReviewSave.Kept(),
            play: ReviewPlay.Stopped(),
            playsStarted: 0,
            exported: ReviewExported.Nothing(),
            maybePlayFailure: Option.none(),
          }),
        ),
      }
    : unchanged(model)

export const failedLoadReview = (model: Model, reason: string): ReviewUpdate =>
  model.review._tag === 'Loading'
    ? { model: withPage(model, ReviewPage.Failed({ reason })) }
    : unchanged(model)

// The draft changed: written now, or once the write under way is done.
const changedDraft = (
  model: Model,
  page: ReviewReady,
  draft: ReviewDraft,
): ReviewUpdate => {
  const writing = page.save._tag === 'Saving'
  return {
    model: withPage(model, {
      ...page,
      draft,
      save: ReviewSave.Saving({ again: writing }),
      exported: ReviewExported.Nothing(),
    }),
    commands: writing ? [] : [SaveReview({ draft })],
  }
}

export const succeededSaveReview = (model: Model): ReviewUpdate =>
  ready(model, page =>
    page.save._tag === 'Saving' && page.save.again
      ? {
          model: withPage(model, {
            ...page,
            save: ReviewSave.Saving({ again: false }),
          }),
          commands: [SaveReview({ draft: page.draft })],
        }
      : { model: withPage(model, { ...page, save: ReviewSave.Kept() }) },
  )

// A failed write is said, and the next change tries again with
// everything; a change already waiting is written now.
export const failedSaveReview = (model: Model, reason: string): ReviewUpdate =>
  ready(model, page =>
    page.save._tag === 'Saving' && page.save.again
      ? {
          model: withPage(model, {
            ...page,
            save: ReviewSave.Saving({ again: false }),
          }),
          commands: [SaveReview({ draft: page.draft })],
        }
      : {
          model: withPage(model, {
            ...page,
            save: ReviewSave.Failed({ reason }),
          }),
        },
  )

export const changedReviewer = (model: Model, name: string): ReviewUpdate =>
  ready(model, page =>
    changedDraft(model, page, { ...page.draft, reviewer: name }),
  )

export const choseVerdict = (
  model: Model,
  lineId: string,
  verdict: ReviewVerdict,
): ReviewUpdate =>
  ready(model, page =>
    changedDraft(
      model,
      page,
      withVerdict(page.draft, lineId, before =>
        Option.some(givenVerdict(before, lineId, verdict)),
      ),
    ),
  )

export const clearedVerdict = (model: Model, lineId: string): ReviewUpdate =>
  ready(model, page =>
    changedDraft(
      model,
      page,
      withVerdict(page.draft, lineId, () => Option.none()),
    ),
  )

// The accent chosen for a line whose accent the reviewer changes: a
// type from the list's own choices, or none while "Choose" is shown.
export const choseAccent = (
  model: Model,
  lineId: string,
  chosen: string,
): ReviewUpdate =>
  ready(model, page =>
    changedDraft(
      model,
      page,
      withVerdict(page.draft, lineId, before =>
        Option.map(before, ({ accentType: _, ...verdict }) =>
          /^\d+$/.test(chosen) && verdict.verdict === 'correct'
            ? { ...verdict, accentType: Number(chosen) }
            : verdict,
        ),
      ),
    ),
  )

export const changedNote = (
  model: Model,
  lineId: string,
  note: string,
): ReviewUpdate =>
  ready(model, page =>
    changedDraft(
      model,
      page,
      withVerdict(page.draft, lineId, before =>
        Option.map(before, ({ note: _, ...verdict }) =>
          note === '' ? verdict : { ...verdict, note },
        ),
      ),
    ),
  )

export const clickedPlay = (model: Model, lineId: string): ReviewUpdate =>
  ready(model, page => ({
    model: withPage(model, {
      ...page,
      play: ReviewPlay.Playing({ lineId, playNumber: page.playsStarted + 1 }),
      playsStarted: page.playsStarted + 1,
      maybePlayFailure: Option.none(),
    }),
  }))

export const clickedStop = (model: Model): ReviewUpdate =>
  ready(model, page => ({
    model: withPage(model, { ...page, play: ReviewPlay.Stopped() }),
  }))

const isPlaying = (page: ReviewReady, playNumber: number): boolean =>
  page.play._tag === 'Playing' && page.play.playNumber === playNumber

export const endedPlay = (model: Model, playNumber: number): ReviewUpdate =>
  ready(model, page =>
    isPlaying(page, playNumber)
      ? { model: withPage(model, { ...page, play: ReviewPlay.Stopped() }) }
      : unchanged(model),
  )

export const failedPlay = (
  model: Model,
  playNumber: number,
  reason: string,
): ReviewUpdate =>
  ready(model, page =>
    isPlaying(page, playNumber)
      ? {
          model: withPage(model, {
            ...page,
            play: ReviewPlay.Stopped(),
            maybePlayFailure: Option.some(reason),
          }),
        }
      : unchanged(model),
  )

export const clickedExport = (model: Model): ReviewUpdate =>
  ready(model, page => ({
    model,
    commands: [ExportReview({ draft: page.draft })],
  }))

export const succeededExport = (
  model: Model,
  fileName: string,
  verdicts: number,
): ReviewUpdate =>
  ready(model, page => ({
    model: withPage(model, {
      ...page,
      exported: ReviewExported.Saved({ fileName, verdicts }),
    }),
  }))

export const failedExport = (model: Model, reason: string): ReviewUpdate =>
  ready(model, page => ({
    model: withPage(model, {
      ...page,
      exported: ReviewExported.Refused({ reason }),
    }),
  }))

// Leaving /review stops the line playing.
export const leftReview = (model: Model): Model =>
  model.review._tag === 'Ready'
    ? withPage(model, { ...model.review, play: ReviewPlay.Stopped() })
    : model
