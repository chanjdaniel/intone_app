import { Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { Dialog } from '@foldkit/ui'

import type { TextChoice, TextModelId } from '../../services/history-records'
import { textModelBytes } from '../../services/transcriber'
import type { LevelClip, LevelLine } from '../level/level'
import { levelLineTitle } from '../level/level'
import { progressBar } from '../upload/progressBar'
import {
  LineTextEdit,
  type TextChoiceState,
  TextFormStatus,
  TextJob,
  type TextOffer,
  type TextPurpose,
  TextStep,
  lineTextFieldId,
  pastedTextFieldId,
} from './text'

// The text of the learner's clips on screen: the consent dialog, which
// names the download's size before anything downloads; the job's
// progress, with a way to stop it; a level's text section, where an
// upload's text is written out or pasted; a line's own text, typed under
// its row; and the settings' offer of the download. The words are the
// spec's ("Decisions for the tickets still to build").

export type TextEvents<ViewMessage> = Readonly<{
  writeOut: ViewMessage
  paste: ViewMessage
  editLine: (lineId: string) => ViewMessage
  changeDraft: (text: string) => ViewMessage
  submitText: ViewMessage
  cancelText: ViewMessage
  stop: ViewMessage
  chooseModel: ViewMessage
  dialog: (message: Dialog.Message) => ViewMessage
  selectModel: (model: TextModelId) => ViewMessage
  agree: ViewMessage
  notNow: ViewMessage
}>

const primaryButton = 'button-primary disabled:opacity-60'
const secondaryButton = 'button-secondary disabled:text-muted'

// Megabytes as the dialog says them: a million bytes, whole.
export const megabytesText = (bytes: number): string =>
  `${Math.round(bytes / 1_000_000)} MB`

export const modelSizeText = (model: TextModelId): string =>
  megabytesText(textModelBytes(model))

// The model as the learner reads its name.
export const modelTitle = (model: TextModelId): string =>
  model === 'whisper-base' ? 'Whisper base' : 'Whisper small'

const fraction = (done: number, total: number): number =>
  total > 0 ? Math.min(1, done / total) : 0

// What a running job is doing, in words, and how far it is.
export const stepText = (step: TextStep): string =>
  TextStep.match(step, {
    Decoding: () => 'Reading the clip’s audio.',
    Downloading: ({ done, total }) =>
      `Downloading the text model: ${Math.round(done / 1_000_000)} of ${megabytesText(total)}.`,
    Preparing: () => 'Opening the text model.',
    Transcribing: ({ done, total }) =>
      `Writing out the text: part ${Math.min(done + 1, total)} of ${total}.`,
    Keeping: () => 'Keeping the text on this device.',
  })

const stepProgress = (step: TextStep): Option.Option<number> =>
  TextStep.match(step, {
    Decoding: () => Option.none(),
    Downloading: ({ done, total }) => Option.some(fraction(done, total)),
    Preparing: () => Option.none(),
    Transcribing: ({ done, total }) => Option.some(fraction(done, total)),
    Keeping: () => Option.none(),
  })

const isFor = (purpose: TextPurpose, clipId: string | null): boolean =>
  clipId === null
    ? purpose._tag === 'Download'
    : purpose._tag === 'Transcribe' && purpose.clipId === clipId

// The job, where it is shown: on the clip's level, or, for the model
// alone, on the settings. The line says each step once, in place.
export const textJobView = <ViewMessage>(
  job: TextJob,
  clipId: string | null,
  events: Pick<TextEvents<ViewMessage>, 'stop'>,
  h: HtmlBuilder<ViewMessage>,
): ReadonlyArray<Html> =>
  TextJob.match(job, {
    Idle: () => [],
    Done: () => [],
    Failed: ({ purpose, reason }) =>
      isFor(purpose, clipId)
        ? [
            h.p(
              [h.Role('alert'), h.Class('text-base text-bad break-words')],
              [
                purpose._tag === 'Download'
                  ? `The text model was not downloaded. ${reason}`
                  : `The text was not written out. ${reason}`,
              ],
            ),
          ]
        : [],
    Working: ({ purpose, step }) =>
      isFor(purpose, clipId)
        ? [
            h.div(
              [h.Class('flex flex-col gap-3')],
              [
                h.p(
                  [h.Role('status'), h.Class('text-base text-ink')],
                  [stepText(step)],
                ),
                ...Option.match(stepProgress(step), {
                  onNone: () => [],
                  onSome: progress => [
                    progressBar(
                      progress,
                      purpose._tag === 'Download'
                        ? 'Text model downloaded'
                        : 'Text written out',
                      h,
                    ),
                  ],
                }),
                h.p(
                  [h.Class('text-sm text-muted')],
                  [
                    purpose._tag === 'Download'
                      ? 'It downloads in the background.'
                      : 'It runs in the background: practise any line meanwhile.',
                  ],
                ),
                h.button(
                  [
                    h.Type('button'),
                    h.OnClick(events.stop),
                    ...(step._tag === 'Keeping' ? [h.Disabled(true)] : []),
                    h.Class(`${secondaryButton} self-start`),
                  ],
                  ['Stop'],
                ),
              ],
            ),
          ]
        : [],
  })

const formError = <ViewMessage>(
  id: string,
  status: TextFormStatus,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.p(
    [
      h.Id(id),
      h.Role('alert'),
      h.Class('text-base text-bad break-words empty:hidden'),
    ],
    [status._tag === 'Refused' ? status.reason : ''],
  )

const formActions = <ViewMessage>(
  status: TextFormStatus,
  saveText: string,
  events: Pick<TextEvents<ViewMessage>, 'cancelText'>,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.div(
    [h.Class('flex flex-wrap gap-3')],
    [
      h.button(
        [
          h.Type('submit'),
          ...(status._tag === 'Saving' ? [h.Disabled(true)] : []),
          h.Class(primaryButton),
        ],
        [status._tag === 'Saving' ? 'Saving…' : saveText],
      ),
      h.button(
        [
          h.Type('button'),
          h.OnClick(events.cancelText),
          h.Class(secondaryButton),
        ],
        ['Cancel'],
      ),
    ],
  )

// A line's own text, typed under its row; or the button that opens it.
export const lineTextControls = <ViewMessage>(
  line: LevelLine,
  edit: LineTextEdit,
  events: Pick<
    TextEvents<ViewMessage>,
    'editLine' | 'changeDraft' | 'submitText' | 'cancelText'
  >,
  h: HtmlBuilder<ViewMessage>,
): ReadonlyArray<Html> => {
  const title = levelLineTitle(line)
  if (edit._tag === 'OneLine' && edit.lineId === line.id) {
    const errorId = `${lineTextFieldId}-error`
    return [
      h.form(
        [
          h.OnSubmit(events.submitText),
          h.Class(
            'flex flex-col gap-3 rounded-lg border border-line bg-surface p-4',
          ),
        ],
        [
          h.label(
            [
              h.For(lineTextFieldId),
              h.Class('text-base font-semibold text-ink'),
            ],
            [`${title}’s text`],
          ),
          h.input([
            h.Id(lineTextFieldId),
            h.Type('text'),
            h.Lang('ja'),
            h.Value(edit.draft),
            h.OnInput(events.changeDraft),
            h.Autocomplete('off'),
            h.Spellcheck(false),
            h.AriaDescribedBy(errorId),
            ...(edit.status._tag === 'Refused' ? [h.AriaInvalid(true)] : []),
            h.Class(
              'min-h-11 w-full rounded-md border border-line bg-surface px-3 text-lg text-ink focus-ring',
            ),
          ]),
          formError(errorId, edit.status, h),
          formActions(edit.status, 'Keep the text', events, h),
        ],
      ),
    ]
  }
  return [
    h.div(
      [h.Class('flex px-4')],
      [
        h.button(
          [
            h.Type('button'),
            h.OnClick(events.editLine(line.id)),
            h.AriaLabel(
              Option.isSome(line.maybeText)
                ? `Edit ${title.toLowerCase()}’s text`
                : `Add ${title.toLowerCase()}’s text`,
            ),
            h.Class(
              'inline-flex min-h-11 items-center rounded-md text-base text-accent underline underline-offset-4 focus-ring',
            ),
          ],
          [Option.isSome(line.maybeText) ? 'Edit the text' : 'Add its text'],
        ),
      ],
    ),
  ]
}

const writtenByText = (clip: LevelClip): string =>
  Option.match(clip.maybeWrittenBy, {
    onNone: () =>
      'Its lines have no text yet. Intone can write it out on this device, or you can paste your own.',
    onSome: model =>
      `Written out on this device by ${modelTitle(model)}. It gets some words wrong, names most of all: edit a line’s text under its row, or paste your own.`,
  })

// An upload's text, on its level: what wrote it, the job writing it out,
// and the pasted text's form.
export const levelTextSection = <ViewMessage>(
  clip: LevelClip,
  job: TextJob,
  edit: LineTextEdit,
  events: TextEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html => {
  const working = job._tag === 'Working'
  const pasting = edit._tag === 'WholeClip' && edit.clipId === clip.id
  const pasteErrorId = `${pastedTextFieldId}-error`
  return h.section(
    [
      h.AriaLabelledBy('level-text-heading'),
      h.Class(
        'flex flex-col gap-4 rounded-lg border border-line bg-raised p-5 sm:p-6',
      ),
    ],
    [
      h.h2(
        [h.Id('level-text-heading'), h.Class('text-xl font-bold')],
        ['Text'],
      ),
      h.p([h.Class('text-base text-ink')], [writtenByText(clip)]),
      ...textJobView(job, clip.id, events, h),
      ...(pasting
        ? [
            h.form(
              [h.OnSubmit(events.submitText), h.Class('flex flex-col gap-3')],
              [
                h.label(
                  [
                    h.For(pastedTextFieldId),
                    h.Class('text-base font-semibold text-ink'),
                  ],
                  [
                    `Your text, one line for each of the clip’s ${clip.lines.length === 1 ? 'line' : `${clip.lines.length} lines`}, in order`,
                  ],
                ),
                h.textarea([
                  h.Id(pastedTextFieldId),
                  h.Lang('ja'),
                  h.Value(edit.draft),
                  h.OnInput(events.changeDraft),
                  h.Rows(Math.min(12, Math.max(4, clip.lines.length))),
                  h.Spellcheck(false),
                  h.AriaDescribedBy(pasteErrorId),
                  ...(edit.status._tag === 'Refused'
                    ? [h.AriaInvalid(true)]
                    : []),
                  h.Class(
                    'w-full rounded-md border border-line bg-surface p-3 text-lg leading-relaxed text-ink focus-ring',
                  ),
                ]),
                formError(pasteErrorId, edit.status, h),
                formActions(edit.status, 'Keep this text', events, h),
              ],
            ),
          ]
        : [
            h.div(
              [h.Class('flex flex-wrap gap-3')],
              [
                ...(clip.hasAudio && !working
                  ? [
                      h.button(
                        [
                          h.Type('button'),
                          h.OnClick(events.writeOut),
                          h.Class(primaryButton),
                        ],
                        [
                          Option.isSome(clip.maybeWrittenBy)
                            ? 'Write out the text again'
                            : 'Write out the text',
                        ],
                      ),
                    ]
                  : []),
                h.button(
                  [
                    h.Type('button'),
                    h.OnClick(events.paste),
                    h.Class(secondaryButton),
                  ],
                  ['Paste your own text'],
                ),
              ],
            ),
          ]),
    ],
  )
}

const choiceText = (maybeChoice: Option.Option<TextChoice>): string =>
  Option.match(maybeChoice, {
    onNone: () =>
      'Intone can write out the text of the clips you bring, on this device, after a one-time download.',
    onSome: choice =>
      choice._tag === 'Declined'
        ? 'You said not now to the text model’s download, so your clips are not written out. You can still type or paste their text.'
        : `Your clips’ text is written out on this device by ${modelTitle(choice.model)}, a ${modelSizeText(choice.model)} download the browser keeps.`,
  })

// The settings' section: the answer given, and the download offered
// again.
export const settingsTextSection = <ViewMessage>(
  choice: TextChoiceState,
  job: TextJob,
  events: Pick<TextEvents<ViewMessage>, 'chooseModel' | 'stop'>,
  h: HtmlBuilder<ViewMessage>,
): Html => {
  const maybeChoice =
    choice._tag === 'Read' ? choice.maybeChoice : Option.none<TextChoice>()
  const agreed = Option.exists(maybeChoice, found => found._tag === 'Agreed')
  return h.section(
    [
      h.AriaLabelledBy('text-model-heading'),
      h.Class(
        'flex flex-col gap-4 rounded-lg border border-line bg-raised p-5 sm:p-6',
      ),
    ],
    [
      h.h2(
        [h.Id('text-model-heading'), h.Class('text-xl font-bold')],
        ['Text for your lines'],
      ),
      h.p([h.Class('text-base text-ink')], [choiceText(maybeChoice)]),
      h.p(
        [h.Class('text-sm text-muted')],
        [
          'The text is for reading only: it never changes a match, and it never leaves this device.',
        ],
      ),
      ...textJobView(job, null, events, h),
      ...(job._tag === 'Working'
        ? []
        : [
            h.button(
              [
                h.Type('button'),
                h.OnClick(events.chooseModel),
                h.Class(
                  `${agreed ? secondaryButton : primaryButton} self-start`,
                ),
              ],
              [
                agreed
                  ? 'Choose another text model'
                  : 'Download the text model',
              ],
            ),
          ]),
    ],
  )
}

// The consent dialog: the frontend patterns' narrow width for two
// controls, with the body, the choice and the actions in one form. It
// opens on "Not now", so Enter never starts a download by itself.
export const textDialogView = <ViewMessage>(
  dialog: Dialog.Model,
  offer: TextOffer,
  events: Pick<
    TextEvents<ViewMessage>,
    'dialog' | 'selectModel' | 'agree' | 'notNow'
  >,
  h: HtmlBuilder<ViewMessage>,
): Html => {
  const model: TextModelId =
    offer._tag === 'Open' ? offer.model : 'whisper-base'
  const larger = model === 'whisper-small'
  const choiceId = 'text-model-larger'
  return h.submodel({
    slotId: dialog.id,
    model: dialog,
    view: Dialog.view,
    viewInputs: {
      hasDescription: true,
      toView: ({
        dialog: dialogAttributes,
        backdrop,
        panel,
        title,
        description,
        initialFocus,
        isVisible,
      }) =>
        h.dialog(
          [
            ...dialogAttributes,
            h.Class('bg-transparent p-0 open:flex items-center justify-center'),
          ],
          isVisible
            ? [
                h.div([...backdrop, h.Class('fixed inset-0 bg-ink/50')]),
                h.form(
                  [
                    ...panel,
                    h.OnSubmit(events.agree),
                    h.Class(
                      'relative flex w-[min(100%-2rem,26rem)] flex-col gap-4 rounded-lg border border-line bg-surface p-6 text-ink shadow-lg',
                    ),
                  ],
                  [
                    h.h2(
                      [...title, h.Class('text-xl font-bold')],
                      ['Download the text model?'],
                    ),
                    h.p(
                      [...description, h.Class('text-base text-ink')],
                      [
                        `Intone can write out each line’s text, on this device. It needs a one-time download of ${modelSizeText(model)}, which the browser keeps. Your clip never leaves this device.`,
                      ],
                    ),
                    h.div(
                      [h.Class('flex items-start gap-3')],
                      [
                        h.input([
                          h.Id(choiceId),
                          h.Type('checkbox'),
                          h.Checked(larger),
                          h.OnClick(
                            events.selectModel(
                              larger ? 'whisper-base' : 'whisper-small',
                            ),
                          ),
                          h.Class(
                            'mt-2.5 size-6 shrink-0 accent-accent focus-ring',
                          ),
                        ]),
                        h.label(
                          [
                            h.For(choiceId),
                            h.Class(
                              'flex min-h-11 items-center text-base text-ink',
                            ),
                          ],
                          [
                            `Larger model, better text (whisper-small, ${modelSizeText('whisper-small')})`,
                          ],
                        ),
                      ],
                    ),
                    h.div(
                      [h.Class('flex flex-wrap justify-end gap-3')],
                      [
                        h.button(
                          [
                            ...initialFocus,
                            h.Type('button'),
                            h.OnClick(events.notNow),
                            h.Class(secondaryButton),
                          ],
                          ['Not now'],
                        ),
                        h.button(
                          [h.Type('submit'), h.Class(primaryButton)],
                          [`Download ${modelSizeText(model)}`],
                        ),
                      ],
                    ),
                  ],
                ),
              ]
            : [],
        ),
    },
    toParentMessage: events.dialog,
  })
}
