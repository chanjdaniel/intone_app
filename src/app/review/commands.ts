import { Effect } from 'effect'
import { Calendar, Command } from 'foldkit'

import { ReviewDraft, ReviewStore } from '../../services/review-store'
import { isoDayOf } from '../history/format'
import { starterPack } from '../line/starter'
import { Message } from '../message'
import { saveFile } from '../saveFile'
import { reviewExportOf, reviewFileName } from './review'

// Reading the verdicts kept on the device when /review opens, keeping
// them after each change, and saving them as one file.

export const LoadReview = Command.define('LoadReview', {
  messages: [Message.SucceededLoadReview, Message.FailedLoadReview],
  execute: Effect.gen(function* () {
    const store = yield* ReviewStore
    return Message.SucceededLoadReview({ draft: yield* store.draft })
  }).pipe(
    Effect.provide(ReviewStore.layer),
    Effect.catch(error =>
      Effect.succeed(Message.FailedLoadReview({ reason: error.reason })),
    ),
  ),
})

export const SaveReview = Command.define('SaveReview', {
  args: { draft: ReviewDraft },
  messages: [Message.SucceededSaveReview, Message.FailedSaveReview],
  execute: ({ draft }) =>
    Effect.gen(function* () {
      const store = yield* ReviewStore
      yield* store.setDraft(draft)
      return Message.SucceededSaveReview()
    }).pipe(
      Effect.provide(ReviewStore.layer),
      Effect.catch(error =>
        Effect.succeed(Message.FailedSaveReview({ reason: error.reason })),
      ),
    ),
})

// The export, dated by the learner's day, in the shape
// scripts/starter-pack.ts --apply reads (src/services/starter-records.ts).
export const ExportReview = Command.define('ExportReview', {
  args: { draft: ReviewDraft },
  messages: [Message.SucceededExportReview, Message.FailedExportReview],
  execute: ({ draft }) =>
    Effect.gen(function* () {
      const day = isoDayOf(yield* Calendar.today.local)
      const made = reviewExportOf(
        draft,
        starterPack.levels.flatMap(level => level.lines),
        day,
      )
      if (typeof made === 'string') {
        return Message.FailedExportReview({ reason: made })
      }
      const fileName = reviewFileName(day)
      yield* Effect.forkDetach(
        saveFile(
          new TextEncoder().encode(`${JSON.stringify(made, null, 2)}\n`),
          fileName,
          'application/json',
        ),
      )
      return Message.SucceededExportReview({
        fileName,
        verdicts: made.verdicts.length,
      })
    }),
})
