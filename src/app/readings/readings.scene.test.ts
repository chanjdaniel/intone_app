import { Option } from 'effect'
import {
  Mount,
  all,
  expect,
  first,
  given,
  label,
  last,
  role,
  scene,
  selector,
  text,
} from 'foldkit/scene'
import { describe, test } from 'vitest'

import { wordsOf } from '../../engine/text/readings'
import { NativeCurve } from '../line/native'
import {
  AppRoute,
  Message,
  type Model,
  initialModel,
  update,
  view,
} from '../main'
import { DrawCurvePair } from '../take/curvePair'
import { sampleCurve, sampleFeatures, sampleLine } from '../take/testCurves'
import { TextFormStatus } from '../text/text'
import {
  LineReadingsState,
  ReadingFixForm,
  ReadingsChoice,
  ReadingsTool,
  readingFieldId,
  shownWordsOf,
} from './readings'

// A line's readings on its practice screen: offered with their size
// before the first download, the kanji with their kana over them as ruby
// once read, a corrected reading in the accent's colour, and the form
// that corrects them, one field a word.

const target = { clipId: 'ame-ga-suki', lineId: '1', text: '雨が好き' }

const dictionaryWords = wordsOf('雨が好き', [
  { surface: '雨', reading: 'アメ' },
  { surface: 'が', reading: 'ガ' },
  { surface: '好き', reading: 'スキ' },
])

// The bundled line's screen, known at once, its native curve not read.
const onLine = (overrides: Partial<Model> = {}): Model => ({
  ...initialModel(AppRoute.Line({ clipId: 'ame-ga-suki', lineId: '1' })),
  readingsChoice: ReadingsChoice.Read({ maybeShown: Option.none() }),
  ...overrides,
})

const shown = ReadingsChoice.Read({ maybeShown: Option.some('Shown') })

const read = (
  fixes: ReadonlyArray<{ from: number; to: number; kana: string }> = [],
) =>
  LineReadingsState.Ready({
    ...target,
    words: shownWordsOf(
      target.text,
      dictionaryWords,
      fixes.length === 0
        ? Option.none()
        : Option.some({ text: target.text, fixes }),
    ),
  })

describe('a line’s readings', () => {
  test('are offered with the download’s size until first shown, the line bare', () => {
    scene(
      { update, view },
      given(onLine()),
      expect(role('heading', { name: '雨が好き', level: 1 })).toExist(),
      expect(selector('ruby')).toBeAbsent(),
      expect(role('button', { name: 'Show readings' })).toExist(),
      expect(
        text(
          'Shows the kana over the kanji. The first time, it downloads the reading dictionary, 12 MB, from Intone itself.',
        ),
      ).toExist(),
    )
  })

  test('once shown before, are offered with no size', () => {
    scene(
      { update, view },
      given(
        onLine({
          readingsChoice: ReadingsChoice.Read({
            maybeShown: Option.some('Hidden'),
          }),
        }),
      ),
      expect(role('button', { name: 'Show readings' })).toExist(),
      expect(text(/downloads the reading dictionary/)).toBeAbsent(),
    )
  })

  test('say they are loading until the line is read', () => {
    scene(
      { update, view },
      given(onLine({ readingsChoice: shown })),
      expect(role('status')).toHaveText('Loading the readings…'),
      expect(role('button', { name: 'Hide readings' })).toExist(),
      expect(selector('ruby')).toBeAbsent(),
    )
  })

  test('show each run of kanji with its kana over it, in the line’s Japanese heading', () => {
    scene(
      { update, view },
      given(
        onLine({
          readingsChoice: shown,
          readingsTool: ReadingsTool.Acquired(),
          readings: read(),
        }),
      ),
      expect(selector('h1[lang="ja"] ruby')).toExist(),
      expect(first(all.selector('h1 ruby'))).toHaveText('雨(あめ)'),
      expect(last(all.selector('h1 ruby'))).toHaveText('好(す)'),
      expect(role('heading', { level: 1 })).toHaveText('雨(あめ)が好(す)き'),
      expect(role('button', { name: 'Edit a reading' })).toExist(),
      expect(role('status')).toHaveText(
        'Readings come from a dictionary and may be wrong; edit any that are.',
      ),
    )
  })

  test('mark a reading the learner corrected', () => {
    scene(
      { update, view },
      given(
        onLine({
          readingsChoice: shown,
          readingsTool: ReadingsTool.Acquired(),
          readings: read([{ from: 0, to: 1, kana: 'あま' }]),
        }),
      ),
      expect(first(all.selector('h1 rt'))).toHaveClass('text-accent'),
      expect(first(all.selector('h1 rt'))).toHaveText('あま'),
      expect(last(all.selector('h1 rt'))).toHaveClass('text-muted'),
      expect(role('status')).toHaveText('One reading is your own, in colour.'),
    )
  })

  test('that did not load say why and how to try again', () => {
    scene(
      { update, view },
      given(
        onLine({
          readingsChoice: shown,
          readingsTool: ReadingsTool.Failed({
            reason: 'The reading dictionary could not be downloaded.',
          }),
        }),
      ),
      expect(role('status')).toHaveText(
        'The readings did not load: The reading dictionary could not be downloaded. Hide them and show them again to try once more.',
      ),
    )
  })

  test('are corrected in a form of one field a word, named by the word', () => {
    scene(
      { update, view },
      given(
        onLine({
          readingsChoice: shown,
          readingsTool: ReadingsTool.Acquired(),
          readings: read(),
          readingFix: ReadingFixForm.Open({
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
                draft: 'suki',
                maybeDictionaryKana: Option.some('すき'),
              },
            ],
            status: TextFormStatus.Refused({
              reason:
                'Write the reading of 好き in kana, or leave it empty for the dictionary’s.',
            }),
          }),
        }),
      ),
      expect(role('heading', { name: 'Edit the readings' })).toExist(),
      expect(label('雨')).toHaveAttr('value', 'あめ'),
      expect(label('好き')).toHaveAttr('id', readingFieldId(2)),
      expect(label('好き')).toHaveAttr('placeholder', 'すき'),
      expect(role('alert')).toHaveText(
        'Write the reading of 好き in kana, or leave it empty for the dictionary’s.',
      ),
      expect(role('button', { name: 'Keep these readings' })).toExist(),
      expect(role('button', { name: 'Edit a reading' })).toBeAbsent(),
    )
  })

  test('are not offered for a line with no text', () => {
    scene(
      { update, view },
      given(
        onLine({
          route: AppRoute.Line({ clipId: 'clip-1', lineId: '2' }),
          native: NativeCurve.Ready({
            clipId: 'clip-1',
            lineId: '2',
            line: {
              ...sampleLine,
              clipId: 'clip-1',
              lineId: '2',
              title: 'Line 2',
              titleIsText: false,
            },
            curve: sampleCurve,
            features: sampleFeatures,
          }),
        }),
      ),
      Mount.resolve(DrawCurvePair, Message.CompletedDrawCurvePair()),
      expect(role('heading', { name: 'Line 2', level: 1 })).toExist(),
      expect(role('button', { name: 'Show readings' })).toBeAbsent(),
    )
  })
})
