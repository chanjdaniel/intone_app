import { Array, Option, Schema } from 'effect'
import { File, Runtime, Update } from 'foldkit'
import { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { FileDrop } from '@foldkit/ui'

import {
  UploadJob,
  UploadPage,
  UploadStep,
  initialUpload,
  refusalOf,
  stepText,
} from '../../upload/upload'
import { uploadPanel } from '../../upload/uploadView'
import { type DevEntry, buttonFocusClass, entryFrame } from '../entry'

// The upload screen's working part in each of its states: the drop zone,
// the cut step by step with its stop button, and what the screen says of
// a file it refused or a cut that was stopped. A file chosen or dropped
// here is not cut: the demo moves to finding its lines and stays there.

const demoFile = new globalThis.File([new Uint8Array(16)], 'reading.mp3', {
  type: 'audio/mpeg',
})

export const shownStates: ReadonlyArray<readonly [string, UploadJob]> = [
  ['Choose a file', UploadJob.Idle()],
  [
    'Reading the file',
    UploadJob.Working({
      jobNumber: 1,
      file: demoFile,
      step: UploadStep.Checking(),
    }),
  ],
  [
    'Finding the lines',
    UploadJob.Working({
      jobNumber: 1,
      file: demoFile,
      step: UploadStep.FindingLines({ done: 42, total: 100 }),
    }),
  ],
  [
    'Finding their pitch',
    UploadJob.Working({
      jobNumber: 1,
      file: demoFile,
      step: UploadStep.TrackingLines({ done: 7, total: 21 }),
    }),
  ],
  [
    'Keeping the clip',
    UploadJob.Working({
      jobNumber: 1,
      file: demoFile,
      step: UploadStep.Keeping(),
    }),
  ],
  [
    'Over ten minutes',
    UploadJob.Refused({
      name: 'whole-episode.m4a',
      reason:
        'It is 23:41 long, and a clip can be at most 10 minutes. Cut it shorter first.',
    }),
  ],
  [
    'Not decodable',
    UploadJob.Refused({
      name: 'interview.wma',
      reason:
        'This browser cannot play it. Convert it to WAV, MP3 or M4A and try again.',
    }),
  ],
  ['Stopped', UploadJob.Cancelled({ name: 'reading.mp3' })],
]

// MODEL

export const Model = Schema.Struct({ upload: UploadPage })
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  ClickedState: { name: Schema.String },
  GotFileDropMessage: { message: FileDrop.Message },
  ClickedCancel: {},
})
export type Message = typeof Message.Type

// INIT

export const init: Runtime.ElementInit<Model, Message> = () => ({
  model: { upload: initialUpload },
})

// UPDATE

const withJob = (model: Model, job: UploadJob): Model =>
  modifyFields(model, {
    upload: upload => modifyFields(upload, { job: () => job }),
  })

const foldFileDrop = Update.foldChild({
  update: FileDrop.update,
  read: (model: Model) => Option.some(model.upload.fileDrop),
  write: (model: Model, nextFileDrop: FileDrop.Model) =>
    modifyFields(model, {
      upload: upload => modifyFields(upload, { fileDrop: () => nextFileDrop }),
    }),
  toParentMessage: (message: FileDrop.Message) =>
    Message.GotFileDropMessage({ message }),
  foldOutMessage: FileDrop.OutMessage.match<Update.Step<Model, Message>>({
    ReceivedFiles:
      ({ files }) =>
      model => {
        const [file] = files
        const refusal = refusalOf(file)
        return {
          model: withJob(
            model,
            refusal === null
              ? UploadJob.Working({
                  jobNumber: 1,
                  file,
                  step: UploadStep.FindingLines({ done: 10, total: 100 }),
                })
              : UploadJob.Refused({ name: File.name(file), reason: refusal }),
          ),
        }
      },
    RejectedNonFiles: () => model => ({ model }),
  }),
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
          () => UploadJob.Idle(),
        ),
      ),
    }),
    GotFileDropMessage: ({ message }) => foldFileDrop(model, message),
    ClickedCancel: () => ({
      model:
        model.upload.job._tag === 'Working'
          ? withJob(
              model,
              UploadJob.Cancelled({ name: File.name(model.upload.job.file) }),
            )
          : model,
    }),
  })

// VIEW

export const readOut = (model: Model): string =>
  UploadJob.match(model.upload.job, {
    Idle: () => 'waiting for a file',
    Working: ({ file, step }) => `${File.name(file)}: ${stepText(step)}`,
    Refused: ({ name }) => `${name} refused`,
    Cancelled: ({ name }) => `${name} stopped`,
  })

export const choices: ReadonlyArray<string> = [
  'One file at a time: a second file dropped while one is cut is ignored. Should it wait its turn instead?',
  'The progress bar gives finding the lines a third and finding their pitch the rest, as the CC0 clips took. Is a single bar enough, or would you like the two steps shown apart?',
  'Stop is offered until the clip is being kept, which takes a moment; after that it finishes. Is that clear enough?',
  'A file that names itself as text or an image is refused before it is read; anything else is tried, and the browser’s decoder decides.',
]

const stateButtons = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Role('group'), h.AriaLabel('State'), h.Class('flex flex-wrap gap-2')],
    shownStates.map(([name]) =>
      h.button(
        [
          h.Type('button'),
          h.OnClick(Message.ClickedState({ name })),
          h.Class(
            `inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-3 text-sm ${buttonFocusClass}`,
          ),
        ],
        [name],
      ),
    ),
  )

export const view = (model: Model, h: HtmlBuilder<Message>): Html =>
  entryFrame(
    {
      title: 'Upload: choosing a file and the cut',
      summary:
        'Choosing or dropping an audio file, the cut into lines with its progress and a way to stop, and what is said of a file that could not be used.',
      demo: [
        stateButtons(model, h),
        uploadPanel(
          model.upload,
          {
            fileDrop: message => Message.GotFileDropMessage({ message }),
            cancel: Message.ClickedCancel(),
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
