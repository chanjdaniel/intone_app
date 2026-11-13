import { Array, Effect, Option, Schema } from 'effect'
import { Command, Dom, Runtime, Update } from 'foldkit'
import { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { FileDrop } from '@foldkit/ui'

import { levelRowAttribute } from '../../level/commands'
import {
  LevelStars,
  levelLinesFound,
  levelRowsPerPage,
} from '../../level/level'
import { levelLineList } from '../../level/levelView'
import { packPanel } from '../../upload/packView'
import {
  PackJob,
  PackStep,
  UploadPage,
  initialUpload,
  packStepText,
} from '../../upload/upload'
import { type DevEntry, entryFrame } from '../entry'
import { examplePackClip } from '../samplePack'

// The local pack's part of /upload in each of its states, and the level
// it becomes: the example pack's lines (fixtures/local-pack/), by their
// text and kana, one with no text by its place, and their source links.
// Files chosen or dropped here are not read: the demo moves to finding
// the new lines' pitch and stays there.

export const shownStates: ReadonlyArray<readonly [string, PackJob]> = [
  ['Choose the pack', PackJob.Idle()],
  [
    'Reading the files',
    PackJob.Working({
      jobNumber: 1,
      files: [],
      step: PackStep.CheckingFiles({ done: 2, total: 3 }),
    }),
  ],
  [
    'Finding the pitch',
    PackJob.Working({
      jobNumber: 1,
      files: [],
      step: PackStep.TrackingLines({ done: 1, total: 4 }),
    }),
  ],
  [
    'Keeping the pack',
    PackJob.Working({ jobNumber: 1, files: [], step: PackStep.Keeping() }),
  ],
  [
    'A file missing',
    PackJob.Refused({
      reason:
        'pack.json names a file you did not choose: audio/kyou.wav. Choose it too, or the folder that holds the pack.',
    }),
  ],
  [
    'A manifest it cannot read',
    PackJob.Refused({
      reason:
        'pack.json is not a pack this app can read: a path from the folder pack.json is in, such as audio/line-1.wav, with no .. in it at ["lines"][2]["file"]. See docs/local-pack.md for its format.',
    }),
  ],
  ['Stopped', PackJob.Cancelled()],
]

// MODEL

export const Model = Schema.Struct({
  upload: UploadPage,
  words: Schema.String,
  shownRows: Schema.Finite,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  ClickedState: { name: Schema.String },
  GotPackDropMessage: { message: FileDrop.Message },
  GotPackFolderMessage: { message: FileDrop.Message },
  ClickedCancel: {},
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

export const init: Runtime.ElementInit<Model, Message> = () => ({
  model: { upload: initialUpload, words: '', shownRows: levelRowsPerPage },
})

// UPDATE

const withJob = (model: Model, packJob: PackJob): Model =>
  modifyFields(model, {
    upload: upload => modifyFields(upload, { packJob: () => packJob }),
  })

const received = FileDrop.OutMessage.match<Update.Step<Model, Message>>({
  ReceivedFiles:
    ({ files }) =>
    model => ({
      model: withJob(
        model,
        PackJob.Working({
          jobNumber: 1,
          files,
          step: PackStep.TrackingLines({ done: 0, total: 4 }),
        }),
      ),
    }),
  RejectedNonFiles: () => model => ({ model }),
})

const foldDrop = Update.foldChild({
  update: FileDrop.update,
  read: (model: Model) => Option.some(model.upload.packDrop),
  write: (model: Model, next: FileDrop.Model) =>
    modifyFields(model, {
      upload: upload => modifyFields(upload, { packDrop: () => next }),
    }),
  toParentMessage: (message: FileDrop.Message) =>
    Message.GotPackDropMessage({ message }),
  foldOutMessage: received,
})

const foldFolder = Update.foldChild({
  update: FileDrop.update,
  read: (model: Model) => Option.some(model.upload.packFolder),
  write: (model: Model, next: FileDrop.Model) =>
    modifyFields(model, {
      upload: upload => modifyFields(upload, { packFolder: () => next }),
    }),
  toParentMessage: (message: FileDrop.Message) =>
    Message.GotPackFolderMessage({ message }),
  foldOutMessage: received,
})

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    ClickedState: ({ name }) => ({
      model: withJob(
        model,
        Option.getOrElse(
          Option.map(
            Array.findFirst(shownStates, ([shown]) => shown === name),
            ([, job]) => job,
          ),
          () => PackJob.Idle(),
        ),
      ),
    }),
    GotPackDropMessage: ({ message }) => foldDrop(model, message),
    GotPackFolderMessage: ({ message }) => foldFolder(model, message),
    ClickedCancel: () => ({
      model:
        model.upload.packJob._tag === 'Working'
          ? withJob(model, PackJob.Cancelled())
          : model,
    }),
    ChangedWords: ({ words }) => ({
      model: modifyFields(model, {
        words: () => words,
        shownRows: () => levelRowsPerPage,
      }),
    }),
    ClickedShowMore: () => ({
      model: modifyFields(model, {
        shownRows: shown => shown + levelRowsPerPage,
      }),
      commands: [FocusRow({ index: model.shownRows })],
    }),
    CompletedFocusRow: () => ({ model }),
  })

// VIEW

export const readOut = (model: Model): string =>
  `${PackJob.match(model.upload.packJob, {
    Idle: () => 'waiting for a pack',
    Working: ({ step }) => packStepText(step),
    Refused: () => 'refused',
    Cancelled: () => 'stopped',
  })}; ${levelLinesFound(examplePackClip.lines, model.words).length} of ${examplePackClip.lines.length} lines found`

export const choices: ReadonlyArray<string> = [
  'A whole selection is refused when pack.json names a file it lacks, naming the files, rather than importing the lines it can. Would you rather have the rest imported, and those lines marked?',
  'A pack’s lines are changed only by importing pack.json again, so its level has no line editor. Should a small fix be possible there too, and written back to nowhere but this device?',
  'A source link is shown under its line, by its site and times, and opens in a new tab. Should it say more of where it leads?',
  'Find looks in each line’s text and kana as well as its number, file and times.',
]

const stateButtons = (h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Role('group'), h.AriaLabel('State'), h.Class('flex flex-wrap gap-2')],
    shownStates.map(([name]) =>
      h.button(
        [
          h.Type('button'),
          h.OnClick(Message.ClickedState({ name })),
          h.Class(
            `inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-3 text-sm focus-ring`,
          ),
        ],
        [name],
      ),
    ),
  )

export const view = (model: Model, h: HtmlBuilder<Message>): Html =>
  entryFrame(
    {
      title: 'Local pack: importing and its lines',
      summary:
        'Choosing pack.json with its audio files or their folder, the import with its progress and a way to stop, what is said of a pack it refused, and the level it becomes, with its source links.',
      demo: [
        stateButtons(h),
        packPanel(
          model.upload,
          {
            packDrop: message => Message.GotPackDropMessage({ message }),
            packFolder: message => Message.GotPackFolderMessage({ message }),
            cancelPack: Message.ClickedCancel(),
          },
          h,
        ),
        levelLineList(
          examplePackClip,
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
