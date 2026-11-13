import { Effect, Option, Schema } from 'effect'
import { Command, Dom, Runtime, type Update } from 'foldkit'
import { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { levelRowAttribute } from '../../level/commands'
import {
  LevelClip,
  LevelStars,
  levelLinesFound,
  levelRowsPerPage,
} from '../../level/level'
import { levelLineList } from '../../level/levelView'
import { type DevEntry, entryFrame } from '../entry'
import { cutStudyClip, musicStudyClip } from '../sampleClips'

// A clip's lines in the large-list frame, as /level/:clipId shows them:
// the LibriVox clip the cut study measured, as its lines came out, the
// same clip over the study's music bed with its lines marked, or a
// ten-minute clip of 200 lines to try the find field and "Show N more"
// on.

// MODEL

export const Model = Schema.Struct({
  clip: LevelClip,
  words: Schema.String,
  shownRows: Schema.Finite,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  ClickedClip: { clip: Schema.Literals(['Study', 'Music', 'Long']) },
  ChangedWords: { words: Schema.String },
  ClickedShowMore: {},
  CompletedFocusRow: {},
})
export type Message = typeof Message.Type

// COMMAND

// Puts focus on row `index`, the first of those just shown, as the app's
// list does.
export const FocusRow = Command.define('FocusRow', {
  args: { index: Schema.Finite },
  messages: [Message.CompletedFocusRow],
  execute: ({ index }) =>
    Dom.focus(`[data-${levelRowAttribute}="${index}"]`).pipe(
      Effect.ignore,
      Effect.as(Message.CompletedFocusRow()),
    ),
})

// INIT

const longClip = (): LevelClip => ({
  id: 'long',
  name: 'ten-minutes.m4a',
  seconds: 600,
  addedAt: 0,
  hasAudio: true,
  lines: Array.from({ length: 200 }, (_, k) => ({
    id: String(k + 1),
    number: k + 1,
    from: k * 3 + 0.2,
    to: k * 3 + 2.6 + (k % 5) * 0.08,
    native: k % 37 === 5 ? 'TooNoisy' : 'Tracked',
    maybeQuality: Option.none(),
    maybeFile: Option.none(),
    maybeText: Option.none(),
    maybeKana: Option.none(),
    maybeSource: Option.none(),
    maybeDetail: Option.none(),
  })),
  maybeUndo: Option.none(),
  origin: 'Upload',
  maybeWrittenBy: Option.none(),
})

export const init: Runtime.ElementInit<Model, Message> = () => ({
  model: { clip: cutStudyClip, words: '', shownRows: levelRowsPerPage },
})

// UPDATE

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    ClickedClip: ({ clip }) => ({
      model: {
        clip:
          clip === 'Long'
            ? longClip()
            : clip === 'Music'
              ? musicStudyClip
              : cutStudyClip,
        words: '',
        shownRows: levelRowsPerPage,
      },
    }),
    ChangedWords: ({ words }) => ({
      model: modifyFields(model, {
        words: () => words,
        shownRows: () => levelRowsPerPage,
      }),
    }),
    ClickedShowMore: () => ({
      model: modifyFields(model, {
        shownRows: rows => rows + levelRowsPerPage,
      }),
      commands: [FocusRow({ index: model.shownRows })],
    }),
    CompletedFocusRow: () => ({ model }),
  })

// VIEW

export const readOut = (model: Model): string => {
  const found = levelLinesFound(model.clip.lines, model.words).length
  return `${model.clip.name}: ${found} of ${model.clip.lines.length} lines found, ${Math.min(found, model.shownRows)} shown`
}

export const choices: ReadonlyArray<string> = [
  'A line has no text until it is transcribed (ticket 16), so it is named by its number and found by its number or its time in the clip. Is that enough to find a line again?',
  'A line too quiet or too noisy to find its pitch stays in the list, marked and not a link, so the clip’s order is kept. Would you rather such lines were left out?',
  'Each row shows the line’s start and end in the clip and its length. Is its length worth the space?',
  'A line marked for low pitch confidence or likely music says so in its row, with the number behind it; the line editor says what it means for the match. Is the row’s short reason enough to decide which lines to fix?',
]

const clipButton = (
  clip: 'Study' | 'Music' | 'Long',
  text: string,
  h: HtmlBuilder<Message>,
): Html =>
  h.button(
    [
      h.Type('button'),
      h.OnClick(Message.ClickedClip({ clip })),
      h.Class(
        `inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-3 text-sm focus-ring`,
      ),
    ],
    [text],
  )

export const view = (model: Model, h: HtmlBuilder<Message>): Html =>
  entryFrame(
    {
      title: 'A clip’s lines',
      summary:
        'The lines a clip was cut into, in order, each opening its practice screen, in the app’s one frame for a long list.',
      demo: [
        h.div(
          [h.Class('flex flex-wrap gap-2')],
          [
            clipButton('Study', 'The cut study’s clip', h),
            clipButton('Music', 'The same clip over music', h),
            clipButton('Long', 'A ten-minute clip', h),
          ],
        ),
        levelLineList(
          model.clip,
          LevelStars.Ready({ lines: [] }),
          model.words,
          model.shownRows,
          {
            changedWords: words => Message.ChangedWords({ words }),
            showMore: Message.ClickedShowMore(),
          },
          h,
        ),
      ],
      readOut: readOut(model),
      choices,
    },
    h,
  )

export const entry: DevEntry = {
  makeProgram: container =>
    Runtime.makeElement({ Model, init, update, view, container }),
}
