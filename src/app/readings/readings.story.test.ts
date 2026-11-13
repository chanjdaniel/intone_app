import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { fromString } from 'foldkit/url'
import { describe, expect, test } from 'vitest'

import { wordsOf } from '../../engine/text/readings'
import { AppRoute, Message, type Model, initialModel, update } from '../main'
import { ForgetTakeAudio } from '../take/commands'
import { TextFormStatus } from '../text/text'
import {
  ReadLineReadings,
  SetLineReadings,
  SetReadingsChoice,
} from './commands'
import {
  LineReadingsState,
  ReadingFixForm,
  ReadingsChoice,
  ReadingsTool,
  readingFieldId,
  shownWordsOf,
} from './readings'
import { readingsResources } from './resources'
import { FocusReadings, editReadingsButtonId } from './update'

// The readings' rules, through `update`: nothing loads before the
// learner turns readings on, and the choice is kept; the Worker is held
// only while a line with Japanese text is open with them shown; the
// line's words are asked for once it is loaded, and again once a
// correction is kept; a correction must be in kana, and one left empty
// or written as the dictionary has it is no correction.

const target = { clipId: 'ame-ga-suki', lineId: '1', text: '雨が好き' }

const dictionaryWords = wordsOf('雨が好き', [
  { surface: '雨', reading: 'アメ' },
  { surface: 'が', reading: 'ガ' },
  { surface: '好き', reading: 'スキ' },
])

const words = shownWordsOf(target.text, dictionaryWords, Option.none())

const onLine = (shown: Option.Option<'Shown' | 'Hidden'>): Model => ({
  ...initialModel(AppRoute.Line({ clipId: 'ame-ga-suki', lineId: '1' })),
  readingsChoice: ReadingsChoice.Read({ maybeShown: shown }),
})

const shownAndLoaded = (): Model => ({
  ...onLine(Option.some('Shown')),
  readingsTool: ReadingsTool.Acquired(),
  readings: LineReadingsState.Ready({ ...target, words }),
})

const heldFor = (current: Model) =>
  readingsResources.readings.modelToMaybeRequirements(current)

describe('a line’s readings', () => {
  test('are not loaded, nor the Worker held, before the learner turns them on', () => {
    expect(Option.isNone(heldFor(onLine(Option.none())))).toBe(true)
    expect(Option.isNone(heldFor(onLine(Option.some('Hidden'))))).toBe(true)
    expect(Option.isSome(heldFor(onLine(Option.some('Shown'))))).toBe(true)
    // Not on a screen without a line.
    expect(
      Option.isNone(
        heldFor({
          ...onLine(Option.some('Shown')),
          route: AppRoute.Credits(),
        }),
      ),
    ).toBe(true)
  })

  test('turned on, keep the choice, and once the Worker is loaded read the open line’s words', () => {
    story(
      update,
      given(onLine(Option.none())),
      message(Message.ClickedShowReadings()),
      Command.expectExact(SetReadingsChoice({ shown: 'Shown' })),
      Command.resolve(SetReadingsChoice, Message.SucceededSetReadingsChoice()),
      model(current => {
        expect(current.readingsChoice).toStrictEqual(
          ReadingsChoice.Read({ maybeShown: Option.some('Shown') }),
        )
        expect(current.readings).toStrictEqual(LineReadingsState.Idle())
      }),
      message(Message.AcquiredReadings()),
      Command.expectExact(ReadLineReadings(target)),
      Command.resolve(
        ReadLineReadings,
        Message.SucceededReadLineReadings({ ...target, words }),
      ),
      model(current =>
        expect(current.readings).toStrictEqual(
          LineReadingsState.Ready({ ...target, words }),
        ),
      ),
    )
  })

  test('turned off, go from the screen, and the Worker with them', () => {
    story(
      update,
      given(shownAndLoaded()),
      message(Message.ClickedHideReadings()),
      Command.expectExact(SetReadingsChoice({ shown: 'Hidden' })),
      Command.resolve(SetReadingsChoice, Message.SucceededSetReadingsChoice()),
      model(current => {
        expect(current.readings).toStrictEqual(LineReadingsState.Idle())
        expect(Option.isNone(heldFor(current))).toBe(true)
      }),
    )
  })

  test('go when the line is left', () => {
    story(
      update,
      given(shownAndLoaded()),
      message(
        Message.ChangedUrl({
          url: Option.getOrThrow(fromString('http://localhost/credits')),
        }),
      ),
      Command.resolve(ForgetTakeAudio, Message.CompletedForgetTakeAudio()),
      model(current =>
        expect(current.readings).toStrictEqual(LineReadingsState.Idle()),
      ),
    )
  })

  test('that did not load say why, and are asked for anew once turned off and on', () => {
    story(
      update,
      given(onLine(Option.some('Shown'))),
      message(
        Message.FailedAcquireReadings({
          reason: 'The reading dictionary could not be downloaded.',
        }),
      ),
      model(current =>
        expect(current.readingsTool).toStrictEqual(
          ReadingsTool.Failed({
            reason: 'The reading dictionary could not be downloaded.',
          }),
        ),
      ),
      message(Message.ClickedHideReadings()),
      Command.resolve(SetReadingsChoice, Message.SucceededSetReadingsChoice()),
      model(current =>
        expect(current.readingsTool).toStrictEqual(ReadingsTool.Released()),
      ),
    )
  })

  test('corrected, keep the learner’s kana for the word, and are read again with it', () => {
    story(
      update,
      given(shownAndLoaded()),
      message(Message.ClickedEditReadings()),
      Command.expectExact(FocusReadings({ id: readingFieldId(0) })),
      Command.resolve(FocusReadings, Message.CompletedFocusReadings()),
      model(current =>
        expect(current.readingFix).toStrictEqual(
          ReadingFixForm.Open({
            ...target,
            drafts: [
              {
                from: 0,
                to: 1,
                surface: '雨',
                draft: 'あめ',
                maybeDictionaryKana: Option.some('あめ'),
              },
              {
                from: 2,
                to: 4,
                surface: '好き',
                draft: 'すき',
                maybeDictionaryKana: Option.some('すき'),
              },
            ],
            status: TextFormStatus.Open(),
          }),
        ),
      ),
      message(Message.ChangedReadingDraft({ from: 0, text: ' あま ' })),
      message(Message.SubmittedReadings()),
      Command.expectExact(
        SetLineReadings({
          ...target,
          fixes: [{ from: 0, to: 1, kana: 'あま' }],
        }),
      ),
      Command.resolve(
        SetLineReadings,
        Message.SucceededSetLineReadings({
          clipId: 'ame-ga-suki',
          lineId: '1',
        }),
      ),
      Command.expectExact(
        FocusReadings({ id: editReadingsButtonId }),
        ReadLineReadings(target),
      ),
      Command.resolve(FocusReadings, Message.CompletedFocusReadings()),
      model(current => {
        expect(current.readingFix).toStrictEqual(ReadingFixForm.Closed())
        expect(current.readings).toStrictEqual(
          LineReadingsState.Reading(target),
        )
      }),
      Command.resolve(
        ReadLineReadings,
        Message.SucceededReadLineReadings({
          ...target,
          words: shownWordsOf(
            target.text,
            dictionaryWords,
            Option.some({
              text: target.text,
              fixes: [{ from: 0, to: 1, kana: 'あま' }],
            }),
          ),
        }),
      ),
      model(current => {
        expect(current.readings._tag).toBe('Ready')
        if (current.readings._tag === 'Ready') {
          expect(
            current.readings.words.map(word => [
              word.surface,
              Option.getOrNull(word.maybeKana),
              word.fixed,
            ]),
          ).toStrictEqual([
            ['雨', 'あま', true],
            ['が', null, false],
            ['好き', 'すき', false],
          ])
        }
      }),
    )
  })

  test('refuse a correction not in kana, and take an empty one or the dictionary’s as none', () => {
    story(
      update,
      given(shownAndLoaded()),
      message(Message.ClickedEditReadings()),
      Command.resolve(FocusReadings, Message.CompletedFocusReadings()),
      message(Message.ChangedReadingDraft({ from: 2, text: 'suki' })),
      message(Message.SubmittedReadings()),
      Command.expectExact(FocusReadings({ id: readingFieldId(2) })),
      Command.resolve(FocusReadings, Message.CompletedFocusReadings()),
      model(current =>
        expect(
          current.readingFix._tag === 'Open' && current.readingFix.status,
        ).toStrictEqual(
          TextFormStatus.Refused({
            reason:
              'Write the reading of 好き in kana, or leave it empty for the dictionary’s.',
          }),
        ),
      ),
      message(Message.ChangedReadingDraft({ from: 2, text: '' })),
      message(Message.SubmittedReadings()),
      Command.expectExact(SetLineReadings({ ...target, fixes: [] })),
      Command.resolve(
        SetLineReadings,
        Message.FailedSetLineReadings({
          clipId: 'ame-ga-suki',
          lineId: '1',
          reason: 'The readings were not kept.',
        }),
      ),
      model(current =>
        expect(
          current.readingFix._tag === 'Open' && current.readingFix.status,
        ).toStrictEqual(
          TextFormStatus.Refused({ reason: 'The readings were not kept.' }),
        ),
      ),
    )
  })
})

describe('the words a line shows', () => {
  test('take the learner’s corrections only on the text they were made on', () => {
    const fix = { from: 0, to: 1, kana: 'あま' }
    expect(
      shownWordsOf(
        target.text,
        dictionaryWords,
        Option.some({ text: '雨が嫌い', fixes: [fix] }),
      ).some(word => word.fixed),
    ).toBe(false)
    expect(
      shownWordsOf(
        target.text,
        dictionaryWords,
        Option.some({ text: target.text, fixes: [fix] }),
      )[0],
    ).toStrictEqual({
      from: 0,
      to: 1,
      surface: '雨',
      maybeKana: Option.some('あま'),
      maybeDictionaryKana: Option.some('あめ'),
      fixed: true,
    })
  })
})
