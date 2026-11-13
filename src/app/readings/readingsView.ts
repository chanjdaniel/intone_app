import { Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { rubyParts } from '../../engine/text/readings'
import { readingsDownloadBytes } from '../../services/readings'
import { megabytesText } from '../text/textView'
import {
  LineReadingsState,
  type ReadingFixForm,
  type ReadingsChoice,
  type ReadingsTool,
  type ShownWord,
  isShown,
  readingFieldId,
} from './readings'
import { editReadingsButtonId } from './update'

// A line's readings on its practice screen: its text with the kana over
// its kanji, as ruby, a word the learner corrected marked in the accent's
// colour; the button that shows or hides them, which says the download's
// size until they are first shown; and the form that corrects them, one
// field a word.

export type ReadingsState = Readonly<{
  choice: ReadingsChoice
  tool: ReadingsTool
  readings: LineReadingsState
  form: ReadingFixForm
}>

export type ReadingsEvents<ViewMessage> = Readonly<{
  show: ViewMessage
  hide: ViewMessage
  edit: ViewMessage
  changeDraft: (from: number, text: string) => ViewMessage
  submit: ViewMessage
  cancel: ViewMessage
}>

// The line's words with their readings, when they are shown for `text`.
export const shownWords = (
  state: ReadingsState,
  text: string,
): Option.Option<ReadonlyArray<ShownWord>> =>
  isShown(state.choice) &&
  state.readings._tag === 'Ready' &&
  state.readings.text === text
    ? Option.some(state.readings.words)
    : Option.none()

// The text as ruby: each run of kanji with its kana over it, the rest
// bare, and the parentheses a browser with no ruby shows instead.
export const rubyText = <ViewMessage>(
  words: ReadonlyArray<ShownWord>,
  h: HtmlBuilder<ViewMessage>,
): ReadonlyArray<Html | string> =>
  words.flatMap(word =>
    rubyParts(word.surface, Option.getOrNull(word.maybeKana)).map(part =>
      part.ruby === null
        ? part.base
        : h.ruby(
            [],
            [
              part.base,
              h.rp([], ['(']),
              h.rt(
                [
                  h.Class(
                    word.fixed
                      ? 'text-[0.5em] font-semibold text-accent [ruby-align:center]'
                      : 'text-[0.5em] font-normal text-muted [ruby-align:center]',
                  ),
                ],
                [part.ruby],
              ),
              h.rp([], [')']),
            ],
          ),
    ),
  )

const toggleButton = <ViewMessage>(
  state: ReadingsState,
  events: ReadingsEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html => {
  const shown = isShown(state.choice)
  return h.button(
    [
      h.Type('button'),
      h.OnClick(shown ? events.hide : events.show),
      h.Class('button-secondary'),
    ],
    [shown ? 'Hide readings' : 'Show readings'],
  )
}

// What the readings are doing, said in a polite live region that stays in
// place; not a `status`, which the take's panel is, the screen's one.
export const readingsNoteId = 'readings-note'

const statusText = (state: ReadingsState): string => {
  if (state.choice._tag !== 'Read') {
    return ''
  }
  if (!isShown(state.choice)) {
    return Option.isNone(state.choice.maybeShown)
      ? `Shows the kana over the kanji. The first time, it downloads the reading dictionary, ${megabytesText(readingsDownloadBytes)}, from Intone itself.`
      : ''
  }
  if (state.tool._tag === 'Failed') {
    return `The readings did not load: ${state.tool.reason} Hide them and show them again to try once more.`
  }
  return LineReadingsState.match(state.readings, {
    Ready: ({ words }) => {
      const fixed = words.filter(word => word.fixed).length
      return fixed === 0
        ? 'Readings come from a dictionary and may be wrong; edit any that are.'
        : `${fixed === 1 ? 'One reading is' : `${fixed} readings are`} your own, in colour.`
    },
    Failed: ({ reason }) => `The readings could not be read: ${reason}`,
    Idle: () => 'Loading the readings…',
    Reading: () => 'Loading the readings…',
  })
}

const fixForm = <ViewMessage>(
  form: Extract<ReadingFixForm, { _tag: 'Open' }>,
  events: ReadingsEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html => {
  const errorId = 'readings-error'
  return h.form(
    [
      h.OnSubmit(events.submit),
      h.AriaLabelledBy('readings-form-heading'),
      h.Class(
        'flex flex-col gap-4 rounded-lg border border-line bg-raised p-4 sm:p-5',
      ),
    ],
    [
      h.h2(
        [h.Id('readings-form-heading'), h.Class('text-lg font-bold')],
        ['Edit the readings'],
      ),
      h.p(
        [h.Class('text-base text-muted')],
        [
          'Write each word’s reading in kana. Leave one empty for the dictionary’s.',
        ],
      ),
      h.ul(
        [h.Class('grid grid-cols-1 gap-3 sm:grid-cols-2')],
        form.drafts.map(draft =>
          h.keyed('li')(
            String(draft.from),
            [h.Class('flex flex-col gap-1')],
            [
              h.label(
                [
                  h.For(readingFieldId(draft.from)),
                  h.Lang('ja'),
                  h.Class('text-lg font-semibold text-ink'),
                ],
                [draft.surface],
              ),
              h.input([
                h.Id(readingFieldId(draft.from)),
                h.Type('text'),
                h.Lang('ja'),
                h.Value(draft.draft),
                h.Placeholder(
                  Option.getOrElse(draft.maybeDictionaryKana, () => ''),
                ),
                h.OnInput(text => events.changeDraft(draft.from, text)),
                h.Autocomplete('off'),
                h.Spellcheck(false),
                h.AriaDescribedBy(errorId),
                h.Class(
                  'min-h-11 w-full rounded-md border border-line bg-surface px-3 text-lg text-ink focus-ring',
                ),
              ]),
            ],
          ),
        ),
      ),
      h.p(
        [
          h.Id(errorId),
          h.Role('alert'),
          h.Class('text-base text-bad break-words empty:hidden'),
        ],
        [form.status._tag === 'Refused' ? form.status.reason : ''],
      ),
      h.div(
        [h.Class('flex flex-wrap gap-3')],
        [
          h.button(
            [
              h.Type('submit'),
              ...(form.status._tag === 'Saving' ? [h.Disabled(true)] : []),
              h.Class('button-primary'),
            ],
            [form.status._tag === 'Saving' ? 'Saving…' : 'Keep these readings'],
          ),
          h.button(
            [
              h.Type('button'),
              h.OnClick(events.cancel),
              h.Class('button-secondary'),
            ],
            ['Cancel'],
          ),
        ],
      ),
    ],
  )
}

// The controls under a line with Japanese text.
export const readingsControls = <ViewMessage>(
  state: ReadingsState,
  text: string,
  events: ReadingsEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html => {
  if (state.choice._tag !== 'Read') {
    return h.empty
  }
  const ready = Option.isSome(shownWords(state, text))
  const open = state.form._tag === 'Open' ? state.form : undefined
  return h.div(
    [h.Class('flex flex-col gap-3')],
    [
      h.div(
        [h.Class('flex flex-wrap items-center gap-3')],
        [
          toggleButton(state, events, h),
          ready && open === undefined
            ? h.button(
                [
                  h.Id(editReadingsButtonId),
                  h.Type('button'),
                  h.OnClick(events.edit),
                  h.Class('button-secondary'),
                ],
                ['Edit a reading'],
              )
            : h.empty,
        ],
      ),
      h.p(
        [
          h.Id(readingsNoteId),
          h.AriaLive('polite'),
          h.Class('text-sm text-muted empty:hidden'),
        ],
        [statusText(state)],
      ),
      open === undefined ? h.empty : fixForm(open, events, h),
    ],
  )
}
