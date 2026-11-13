import { Option, Schema } from 'effect'
import { Runtime, Update } from 'foldkit'
import { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { Dialog } from '@foldkit/ui'

import { TextModelId } from '../../../services/history-records'
import type { LevelClip } from '../../level/level'
import {
  LineTextEdit,
  TextFormStatus,
  TextJob,
  TextOffer,
  TextPurpose,
  TextStep,
} from '../../text/text'
import {
  type TextEvents,
  levelTextSection,
  lineTextControls,
  textDialogView,
} from '../../text/textView'
import { type DevEntry, entryFrame } from '../entry'

// An upload's text on its level, in each state the job and the learner's
// own text can be in, a line's row with its text form, and the consent
// dialog, which names the download's size and follows the model chosen.

const states = [
  'Not written out',
  'Downloading',
  'Writing out',
  'Failed',
  'Written out',
  'A long line',
  'Line typed',
  'Pasting, refused',
] as const

const StateName = Schema.Literals(states)
type StateName = typeof StateName.Type

const longText =
  'いや、変調子というのではなく、案外そのような暮しかたのほうが正しいので、かえって私ども一般の家庭のほうこそ変調子になっているのかも知れないが'

// An upload of three lines, as the Model knows it.
const upload: LevelClip = {
  id: 'c1',
  name: 'gongitsune.wav',
  seconds: 10,
  addedAt: 0,
  hasAudio: true,
  lines: [0, 1, 2].map(k => ({
    id: String(k + 1),
    number: k + 1,
    from: k * 3 + 0.4,
    to: k * 3 + 2.9,
    native: 'Tracked',
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
}

const clipOf = (state: StateName): LevelClip => {
  const clip = upload
  const texts =
    state === 'Not written out' ||
    state === 'Downloading' ||
    state === 'Writing out' ||
    state === 'Failed'
      ? []
      : state === 'A long line'
        ? [longText, '中山というところに', '小さなお城があって']
        : ['昔は私たちの村の近くの', '中山というところに', '小さなお城があって']
  return {
    ...clip,
    lines: clip.lines.map((line, k) => ({
      ...line,
      maybeText: Option.fromNullishOr(texts[k]),
    })),
    maybeWrittenBy:
      texts.length === 0 ? Option.none() : Option.some('whisper-base'),
  }
}

const purpose = TextPurpose.Transcribe({ clipId: 'c1' })

const jobOf = (state: StateName): TextJob =>
  state === 'Downloading'
    ? TextJob.Working({
        jobNumber: 1,
        purpose,
        model: 'whisper-base',
        step: TextStep.Downloading({ done: 30_000_000, total: 75_253_316 }),
      })
    : state === 'Writing out'
      ? TextJob.Working({
          jobNumber: 1,
          purpose,
          model: 'whisper-base',
          step: TextStep.Transcribing({ done: 1, total: 4 }),
        })
      : state === 'Failed'
        ? TextJob.Failed({
            purpose,
            model: 'whisper-base',
            reason: 'The text model stopped: out of memory',
          })
        : TextJob.Idle()

const editOf = (state: StateName, draft: string): LineTextEdit =>
  state === 'Line typed'
    ? LineTextEdit.OneLine({
        clipId: 'c1',
        lineId: '3',
        draft,
        status: TextFormStatus.Open(),
      })
    : state === 'Pasting, refused'
      ? LineTextEdit.WholeClip({
          clipId: 'c1',
          draft,
          status: TextFormStatus.Refused({
            reason:
              'That is 2 lines of text, and the clip has 3 lines. Give one line of text for each, in order.',
          }),
        })
      : LineTextEdit.Idle()

// MODEL

export const Model = Schema.Struct({
  state: StateName,
  draft: Schema.String,
  offer: TextOffer,
  dialog: Dialog.Model,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  ClickedState: { state: StateName },
  ChangedDraft: { text: Schema.String },
  ClickedOpenDialog: {},
  GotDialogMessage: { message: Dialog.Message },
  SelectedModel: { model: TextModelId },
  ClickedCloseDialog: {},
  ClickedInert: {},
})
export type Message = typeof Message.Type

// INIT

export const init: Runtime.ElementInit<Model, Message> = () => ({
  model: {
    state: 'Not written out',
    draft: '',
    offer: TextOffer.Closed(),
    dialog: Dialog.init({ id: 'dev-text-model-dialog' }),
  },
})

// UPDATE

const dialogFields = {
  read: (model: Model) => Option.some(model.dialog),
  write: (model: Model, nextDialog: Dialog.Model) =>
    modifyFields(model, { dialog: () => nextDialog }),
  toParentMessage: (message: Dialog.Message) =>
    Message.GotDialogMessage({ message }),
  foldOutMessage: Dialog.OutMessage.match<Update.Step<Model, Message>>({
    Opened: () => model => ({ model }),
    Closed: () => model => ({
      model: modifyFields(model, { offer: () => TextOffer.Closed() }),
    }),
  }),
}

const foldDialog = Update.foldChild({ update: Dialog.update, ...dialogFields })
const foldDialogOpen = Update.foldChildStep({
  update: Dialog.open,
  ...dialogFields,
})
const foldDialogClose = Update.foldChildStep({
  update: Dialog.close,
  ...dialogFields,
})

export const update = (
  model: Model,
  message: Message,
): Update.Return<Model, Message> =>
  Message.match(message, {
    ClickedState: ({ state }) => ({
      model: modifyFields(model, {
        state: () => state,
        draft: () =>
          state === 'Line typed'
            ? '小さなお城'
            : state === 'Pasting, refused'
              ? '昔は\n中山'
              : '',
      }),
    }),
    ChangedDraft: ({ text }) => ({
      model: modifyFields(model, { draft: () => text }),
    }),
    ClickedOpenDialog: () =>
      foldDialogOpen(
        modifyFields(model, {
          offer: () => TextOffer.Open({ purpose, model: 'whisper-base' }),
        }),
      ),
    GotDialogMessage: ({ message: dialogMessage }) =>
      foldDialog(model, dialogMessage),
    SelectedModel: ({ model: textModel }) => ({
      model: modifyFields(model, {
        offer: offer =>
          offer._tag === 'Open'
            ? modifyFields(offer, { model: () => textModel })
            : offer,
      }),
    }),
    ClickedCloseDialog: () => foldDialogClose(model),
    ClickedInert: () => ({ model }),
  })

// VIEW

const events: TextEvents<Message> = {
  writeOut: Message.ClickedOpenDialog(),
  paste: Message.ClickedState({ state: 'Pasting, refused' }),
  editLine: () => Message.ClickedState({ state: 'Line typed' }),
  changeDraft: text => Message.ChangedDraft({ text }),
  submitText: Message.ClickedInert(),
  cancelText: Message.ClickedState({ state: 'Written out' }),
  stop: Message.ClickedState({ state: 'Not written out' }),
  chooseModel: Message.ClickedOpenDialog(),
  dialog: message => Message.GotDialogMessage({ message }),
  selectModel: textModel => Message.SelectedModel({ model: textModel }),
  agree: Message.ClickedCloseDialog(),
  notNow: Message.ClickedCloseDialog(),
}

export const readOut = (model: Model): string =>
  `${model.state}; the dialog ${model.offer._tag === 'Open' ? `open on ${model.offer.model}` : 'shut'}`

export const choices: ReadonlyArray<string> = [
  'The dialog opens once, as an upload’s lines first open, and “Not now” is kept. Would you rather it never opened by itself, and waited for “Write out the text”?',
  'The larger model is a checkbox under the text, and the download button’s size follows it. Is a checkbox clear enough, or should the two models be two choices side by side?',
  'Each line is named by its text once written out, with its number and times under it. Should a line keep its number as its name, and show the text under it instead?',
  'A line’s own text is typed under its row. Would you rather type it on the line’s practice screen?',
]

export const view = (model: Model, h: HtmlBuilder<Message>): Html => {
  const clip = clipOf(model.state)
  const edit = editOf(model.state, model.draft)
  return entryFrame(
    {
      title: 'Text for the lines',
      summary:
        'An upload’s text on its level: the download offered with its size, the job in the background, what wrote the text, a line’s own text and a pasted one.',
      demo: [
        h.div(
          [h.Class('flex flex-wrap gap-2')],
          states.map(state =>
            h.button(
              [
                h.Type('button'),
                h.OnClick(Message.ClickedState({ state })),
                ...(state === model.state ? [h.AriaPressed('true')] : []),
                h.Class(
                  'inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-4 text-base font-semibold text-ink aria-pressed:border-accent focus-ring',
                ),
              ],
              [state],
            ),
          ),
        ),
        levelTextSection(clip, jobOf(model.state), edit, events, h),
        h.ul(
          [h.Class('flex flex-col gap-3')],
          clip.lines.map(line =>
            h.keyed('li')(
              line.id,
              [h.Class('flex flex-col gap-1')],
              [
                h.div(
                  [
                    h.Class(
                      'rounded-lg border border-line bg-raised px-4 py-3 text-ink',
                    ),
                  ],
                  [
                    Option.match(line.maybeText, {
                      onNone: () =>
                        h.span(
                          [h.Class('text-xl font-bold')],
                          [`Line ${line.number}`],
                        ),
                      onSome: text =>
                        h.span(
                          [
                            h.Lang('ja'),
                            h.Class('text-xl font-bold break-words'),
                          ],
                          [text],
                        ),
                    }),
                  ],
                ),
                ...lineTextControls(line, edit, events, h),
              ],
            ),
          ),
        ),
        textDialogView(model.dialog, model.offer, events, h),
      ],
      readOut: readOut(model),
      choices,
    },
    h,
  )
}

export const entry: DevEntry = {
  makeProgram: container =>
    Runtime.makeElement({ Model, init, update, view, container }),
}
