import { Option } from 'effect'
import {
  Command,
  change,
  click,
  expect,
  given,
  inside,
  label,
  role,
  scene,
  text,
} from 'foldkit/scene'
import { describe, test } from 'vitest'

import { moraeOf } from '../../engine/text/morae'
import type { ReviewDraft } from '../../services/review-store'
import { patternOf, starterPack } from '../line/starter'
import { AppRoute, Message, initialModel, update, view } from '../main'
import { ExportReview, SaveReview } from './commands'
import { ReviewExported, ReviewPage, ReviewPlay, ReviewSave } from './review'

// /review lists every starter line with what the list states of it, and
// takes the reviewer's verdicts.

const lines = starterPack.levels.flatMap(level => level.lines)
const [first] = lines
const firstWord = first?.words[0]
if (first === undefined || firstWord === undefined) {
  throw new Error('The starter pack is empty.')
}

const reviewing = (
  draft: ReviewDraft,
  play: ReviewPlay = ReviewPlay.Stopped(),
) => ({
  ...initialModel(AppRoute.Review()),
  review: ReviewPage.Ready({
    draft,
    save: ReviewSave.Kept(),
    play,
    playsStarted: 0,
    exported: ReviewExported.Nothing(),
    maybePlayFailure: Option.none(),
  }),
})

describe('/review', () => {
  test('shows every starter line, its kana, morae and stated accent, by level', () => {
    scene(
      { update, view },
      given(reviewing({ reviewer: '', verdicts: [] })),
      expect(
        role('heading', { name: 'Review the starter lines', level: 1 }),
      ).toExist(),
      ...starterPack.levels.map(level =>
        expect(role('heading', { name: level.name, level: 2 })).toExist(),
      ),
      ...lines.map(line =>
        expect(role('heading', { name: line.text, level: 3 })).toExist(),
      ),
      ...lines.map(line =>
        expect(role('button', { name: `Play ${line.text}` })).toExist(),
      ),
      expect(
        text(
          `Stated: ${firstWord.text} accent type ${firstWord.accentType}, ${patternOf(firstWord.accentType, moraeOf(firstWord.kana).length)}, then ${firstWord.particle}`,
        ),
      ).toExist(),
      expect(text(new RegExp(first.morae.join('・')))).toExist(),
      expect(
        text(
          `0 of ${lines.length} lines have a verdict. Your verdicts are kept on this device.`,
        ),
      ).toExist(),
    )
  })

  test('takes a verdict, then asks the accent when it is another, and a note', () => {
    scene(
      { update, view },
      given(reviewing({ reviewer: '', verdicts: [] })),
      expect(label(`Note, if any`)).toBeAbsent(),
      inside(
        role('group', { name: `Your verdict on ${first.text}` }),
        change(
          role('radio', { name: 'The accent is another: choose it below' }),
          'correct',
        ),
      ),
      Command.resolve(SaveReview, Message.SucceededSaveReview()),
      expect(
        role('combobox', { name: `Accent type of ${firstWord.text}` }),
      ).toExist(),
      expect(label('Note, if any')).toExist(),
      expect(
        text(
          `1 of ${lines.length} lines have a verdict. Your verdicts are kept on this device.`,
        ),
      ).toExist(),
    )
  })

  test('shows Stop for the line playing', () => {
    scene(
      { update, view },
      given(
        reviewing(
          { reviewer: '', verdicts: [] },
          ReviewPlay.Playing({ lineId: first.id, playNumber: 1 }),
        ),
      ),
      expect(role('button', { name: `Stop ${first.text}` })).toExist(),
      click(role('button', { name: `Stop ${first.text}` })),
      expect(role('button', { name: `Play ${first.text}` })).toExist(),
    )
  })

  test('saves the verdicts as a file, and says why it cannot yet', () => {
    const draft = {
      reviewer: '',
      verdicts: [{ lineId: first.id, verdict: 'correct' as const }],
    }
    scene(
      { update, view },
      given(reviewing(draft)),
      click(role('button', { name: 'Save the verdicts as a file' })),
      Command.resolve(
        ExportReview,
        Message.FailedExportReview({
          reason: `Choose the accent type for ${first.text}.`,
        }),
      ),
      expect(
        text(`Not saved. Choose the accent type for ${first.text}.`),
      ).toExist(),
    )
  })

  test('says it could not read the verdicts', () => {
    scene(
      { update, view },
      given({
        ...initialModel(AppRoute.Review()),
        review: ReviewPage.Failed({ reason: 'Blocked.' }),
      }),
      expect(role('alert')).toHaveText(
        'The review could not be read. Blocked.',
      ),
    )
  })
})
