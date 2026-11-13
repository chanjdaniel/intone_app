import { Option, Schema } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { fromString } from 'foldkit/url'
import { describe, expect, test } from 'vitest'

import { emptyReviewDraft } from '../../services/review-store'
import { ReviewExport } from '../../services/starter-records'
import { starterPack } from '../line/starter'
import {
  AppRoute,
  Message,
  type Model,
  init,
  initialModel,
  update,
} from '../main'
import { ExportReview, LoadReview, SaveReview } from './commands'
import {
  ReviewExported,
  ReviewPage,
  ReviewPlay,
  ReviewSave,
  reviewExportOf,
} from './review'

const url = (path: string) =>
  Option.getOrThrow(fromString(`http://localhost${path}`))

const [first, second] = starterPack.levels.flatMap(level => level.lines)
if (first === undefined || second === undefined) {
  throw new Error('The starter pack has fewer than two lines.')
}

const opened = {
  ...initialModel(AppRoute.Review()),
  review: ReviewPage.Ready({
    draft: emptyReviewDraft,
    save: ReviewSave.Kept(),
    play: ReviewPlay.Stopped(),
    playsStarted: 0,
    exported: ReviewExported.Nothing(),
    maybePlayFailure: Option.none(),
  }),
}

const readyOf = (page: ReviewPage) => {
  if (page._tag !== 'Ready') throw new Error(`the page is ${page._tag}`)
  return page
}

describe('/review', () => {
  test('reads the verdicts kept on the device when it opens', () => {
    const start = init(url('/review'))
    expect(start.model.review).toStrictEqual(ReviewPage.Loading())
    expect(start.commands).toMatchObject([{ name: LoadReview.name }])
  })

  test('keeps each verdict as it is given, one write at a time, ending with the latest', () => {
    const accepted = {
      reviewer: '',
      verdicts: [{ lineId: first.id, verdict: 'accept' as const }],
    }
    const noted = {
      reviewer: '',
      verdicts: [
        { lineId: first.id, verdict: 'accept' as const, note: 'clear' },
      ],
    }
    // A Story resolves each Command before the next Message, so the
    // change that comes while a write is under way is sent by hand.
    const step = (from: Model, sent: Message) => {
      const next = update(from, sent)
      return { model: next.model, commands: next.commands ?? [] }
    }
    const chosen = step(
      opened,
      Message.ChoseReviewVerdict({ lineId: first.id, verdict: 'accept' }),
    )
    expect(chosen.commands).toMatchObject([
      { name: SaveReview.name, args: { draft: accepted } },
    ])
    const noted1 = step(
      chosen.model,
      Message.ChangedReviewNote({ lineId: first.id, note: 'clear' }),
    )
    expect(noted1.commands).toStrictEqual([])
    expect(readyOf(noted1.model.review).save).toStrictEqual(
      ReviewSave.Saving({ again: true }),
    )
    const firstKept = step(noted1.model, Message.SucceededSaveReview())
    expect(firstKept.commands).toMatchObject([
      { name: SaveReview.name, args: { draft: noted } },
    ])
    const allKept = step(firstKept.model, Message.SucceededSaveReview())
    expect(allKept.commands).toStrictEqual([])
    expect(readyOf(allKept.model.review).save).toStrictEqual(ReviewSave.Kept())
    expect(readyOf(allKept.model.review).draft).toStrictEqual(noted)
  })

  test('takes an accent only while the verdict is to change it, and keeps the note across verdicts', () => {
    story(
      update,
      given(opened),
      message(
        Message.ChoseReviewVerdict({ lineId: first.id, verdict: 'correct' }),
      ),
      Command.resolve(SaveReview, Message.SucceededSaveReview()),
      message(Message.ChoseReviewAccent({ lineId: first.id, accentType: '2' })),
      Command.resolve(SaveReview, Message.SucceededSaveReview()),
      message(
        Message.ChangedReviewNote({ lineId: first.id, note: 'falls later' }),
      ),
      Command.resolve(SaveReview, Message.SucceededSaveReview()),
      model(current => {
        expect(readyOf(current.review).draft.verdicts).toStrictEqual([
          {
            lineId: first.id,
            verdict: 'correct',
            accentType: 2,
            note: 'falls later',
          },
        ])
      }),
      message(Message.ChoseReviewAccent({ lineId: first.id, accentType: '' })),
      Command.resolve(SaveReview, Message.SucceededSaveReview()),
      message(Message.ChoseReviewAccent({ lineId: first.id, accentType: '1' })),
      Command.resolve(SaveReview, Message.SucceededSaveReview()),
      message(
        Message.ChoseReviewVerdict({ lineId: first.id, verdict: 'accept' }),
      ),
      Command.resolve(SaveReview, Message.SucceededSaveReview()),
      message(
        Message.ChoseReviewVerdict({ lineId: second.id, verdict: 'reject' }),
      ),
      Command.resolve(SaveReview, Message.SucceededSaveReview()),
      model(current => {
        expect(readyOf(current.review).draft.verdicts).toStrictEqual([
          { lineId: first.id, verdict: 'accept', note: 'falls later' },
          { lineId: second.id, verdict: 'reject' },
        ])
      }),
      message(Message.ClickedClearReviewVerdict({ lineId: first.id })),
      Command.resolve(SaveReview, Message.SucceededSaveReview()),
      model(current => {
        expect(readyOf(current.review).draft.verdicts).toStrictEqual([
          { lineId: second.id, verdict: 'reject' },
        ])
      }),
    )
  })

  test('says a write that failed, and tries again with everything on the next change', () => {
    story(
      update,
      given(opened),
      message(Message.ChangedReviewer({ name: 'R' })),
      Command.resolve(
        SaveReview,
        Message.FailedSaveReview({ reason: 'Full.' }),
      ),
      model(current => {
        expect(readyOf(current.review).save).toStrictEqual(
          ReviewSave.Failed({ reason: 'Full.' }),
        )
      }),
      message(Message.ChangedReviewer({ name: 'Ri' })),
      Command.expectHas(
        SaveReview({ draft: { reviewer: 'Ri', verdicts: [] } }),
      ),
      Command.resolve(SaveReview, Message.SucceededSaveReview()),
    )
  })

  test('plays one line at a time, and stops it on leaving the page', () => {
    story(
      update,
      given(opened),
      message(Message.ClickedPlayReviewLine({ lineId: first.id })),
      message(Message.ClickedPlayReviewLine({ lineId: second.id })),
      model(current => {
        expect(readyOf(current.review).play).toStrictEqual(
          ReviewPlay.Playing({ lineId: second.id, playNumber: 2 }),
        )
      }),
      // The first play's end, come late, stops nothing.
      message(Message.EndedReviewPlay({ playNumber: 1 })),
      model(current => {
        expect(readyOf(current.review).play._tag).toBe('Playing')
      }),
      message(Message.ChangedUrl({ url: url('/credits') })),
      model(current => {
        expect(readyOf(current.review).play).toStrictEqual(ReviewPlay.Stopped())
      }),
    )
  })

  test('says why a line did not play, until another plays', () => {
    story(
      update,
      given(opened),
      message(Message.ClickedPlayReviewLine({ lineId: first.id })),
      message(Message.FailedReviewPlay({ playNumber: 1, reason: 'No sound.' })),
      model(current => {
        expect(readyOf(current.review).maybePlayFailure).toStrictEqual(
          Option.some('No sound.'),
        )
      }),
      message(Message.ClickedPlayReviewLine({ lineId: first.id })),
      model(current => {
        expect(readyOf(current.review).maybePlayFailure).toStrictEqual(
          Option.none(),
        )
      }),
    )
  })

  test('saves the verdicts as one file, and says what it saved', () => {
    const draft = {
      reviewer: '',
      verdicts: [{ lineId: first.id, verdict: 'accept' as const }],
    }
    story(
      update,
      given({ ...opened, review: { ...opened.review, draft } }),
      message(Message.ClickedExportReview()),
      Command.expectHas(ExportReview({ draft })),
      Command.resolve(
        ExportReview,
        Message.SucceededExportReview({
          fileName: 'intone-starter-review-2026-12-01.json',
          verdicts: 1,
        }),
      ),
      model(current => {
        expect(readyOf(current.review).exported).toStrictEqual(
          ReviewExported.Saved({
            fileName: 'intone-starter-review-2026-12-01.json',
            verdicts: 1,
          }),
        )
      }),
    )
  })
})

describe('reviewExportOf', () => {
  const lines = starterPack.levels.flatMap(level => level.lines)

  test('gives the verdicts in the set’s order, trimmed, in the shape the script applies', () => {
    const made = reviewExportOf(
      {
        reviewer: '  A. Reviewer ',
        verdicts: [
          { lineId: second.id, verdict: 'correct', accentType: 0, note: ' ' },
          { lineId: first.id, verdict: 'accept', note: ' good ' },
        ],
      },
      lines,
      '2026-12-01',
    )
    expect(made).toStrictEqual({
      reviewedOn: '2026-12-01',
      reviewer: 'A. Reviewer',
      verdicts: [
        { lineId: first.id, verdict: 'accept', note: 'good' },
        { lineId: second.id, verdict: 'correct', accentType: 0 },
      ],
    })
    expect(Schema.decodeUnknownSync(ReviewExport)(made)).toStrictEqual(made)
  })

  test('refuses an empty review, and a changed accent not yet chosen', () => {
    expect(reviewExportOf(emptyReviewDraft, lines, '2026-12-01')).toBe(
      'No line has a verdict yet.',
    )
    expect(
      reviewExportOf(
        { reviewer: '', verdicts: [{ lineId: first.id, verdict: 'correct' }] },
        lines,
        '2026-12-01',
      ),
    ).toBe(`Choose the accent type for ${first.text}.`)
  })
})
