import { File } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { FileDrop } from '@foldkit/ui'

import { pageFrame } from '../pageFrame'
import { uploadStatusAttribute } from './commands'
import { type PackEvents, packPanel } from './packView'
import { progressBar } from './progressBar'
import {
  UploadJob,
  type UploadPage,
  acceptedFiles,
  progressOf,
  stepText,
} from './upload'

// /upload: the learner chooses or drops an audio file, and watches it cut
// into lines, with a way to stop. One plain sentence says the clip stays
// on this device. There is no address to import from and nothing to
// share: a file is the only way in.

export type UploadEvents<ViewMessage> = Readonly<{
  fileDrop: (message: FileDrop.Message) => ViewMessage
  cancel: ViewMessage
}>

export const privacySentence = 'Your clip stays on this device.'

const dropZone = <ViewMessage>(
  page: UploadPage,
  events: UploadEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.submodel({
    slotId: page.fileDrop.id,
    model: page.fileDrop,
    view: FileDrop.view,
    viewInputs: {
      accept: acceptedFiles,
      isDisabled:
        page.job._tag === 'Working' || page.packJob._tag === 'Working',
      toView: attributes =>
        h.label(
          [
            ...attributes.root,
            h.Class(
              'flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed border-line bg-raised px-5 py-10 text-center hover:border-accent has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-accent data-[drag-over]:border-accent data-[drag-over]:bg-surface data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60 sm:py-14',
            ),
          ],
          [
            h.span(
              [
                h.Class(
                  'inline-flex min-h-11 items-center rounded-md bg-accent px-5 text-base font-semibold text-on-accent',
                ),
              ],
              ['Choose an audio file'],
            ),
            h.span([h.Class('text-base text-ink')], ['or drop one here']),
            h.span(
              [h.Class('text-sm text-muted')],
              ['WAV, MP3, M4A and most other audio, up to 10 minutes'],
            ),
            h.input(attributes.input),
          ],
        ),
    },
    toParentMessage: events.fileDrop,
  })

const working = <ViewMessage>(
  job: Extract<UploadJob, { _tag: 'Working' }>,
  events: UploadEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.section(
    [
      h.AriaLabelledBy('upload-working'),
      h.Class(
        'flex flex-col gap-4 rounded-lg border border-line bg-raised p-5 sm:p-6',
      ),
    ],
    [
      h.h2(
        [
          h.Id('upload-working'),
          h.DataAttribute(uploadStatusAttribute, ''),
          h.Tabindex(-1),
          h.Class('text-xl font-bold break-words focus:outline-none'),
        ],
        [`Cutting ${File.name(job.file)} into lines`],
      ),
      progressBar(progressOf(job.step), 'Cutting the clip into lines', h),
      h.p([h.Class('text-base text-ink')], [stepText(job.step)]),
      h.button(
        [
          h.Type('button'),
          ...(job.step._tag === 'Keeping'
            ? [h.Disabled(true)]
            : [h.OnClick(events.cancel)]),
          h.Class(
            `inline-flex min-h-11 items-center justify-center self-start rounded-md border border-line bg-surface px-5 text-base font-semibold text-ink disabled:text-muted focus-ring`,
          ),
        ],
        ['Stop'],
      ),
    ],
  )

// What the screen says of the last file, in one alert or status that is
// focused when it changes, so it is heard once.
const outcome = <ViewMessage>(
  job: UploadJob,
  h: HtmlBuilder<ViewMessage>,
): Html => {
  const said = (role: 'alert' | 'status', text: string) =>
    h.p(
      [
        h.Role(role),
        h.DataAttribute(uploadStatusAttribute, ''),
        h.Tabindex(-1),
        h.Class(
          `rounded-lg border p-4 text-base break-words focus:outline-none ${role === 'alert' ? 'border-bad text-bad' : 'border-line text-ink'}`,
        ),
      ],
      [text],
    )
  return UploadJob.match(job, {
    Idle: () => h.empty,
    Working: () => h.empty,
    Refused: ({ name, reason }) =>
      said('alert', `${name} could not be used. ${reason}`),
    Cancelled: ({ name }) =>
      said('status', `Stopped. Nothing of ${name} was kept.`),
  })
}

// The drop zone, or the cut under way, and what became of the last file:
// the screen's working part, which the dev library shows on its own.
export const uploadPanel = <ViewMessage>(
  page: UploadPage,
  events: UploadEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.div(
    [h.Class('flex flex-col gap-4')],
    [
      UploadJob.match(page.job, {
        Idle: () => dropZone(page, events, h),
        Refused: () => dropZone(page, events, h),
        Cancelled: () => dropZone(page, events, h),
        Working: job => working(job, events, h),
      }),
      outcome(page.job, h),
    ],
  )

export const uploadView = <ViewMessage>(
  page: UploadPage,
  events: UploadEvents<ViewMessage> & PackEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  pageFrame(
    'Lines',
    [
      h.header(
        [h.Class('flex flex-col gap-3')],
        [
          h.h1(
            [h.Class('text-3xl font-bold sm:text-5xl')],
            ['Bring your own audio'],
          ),
          h.p([h.Class('text-lg text-ink')], [privacySentence]),
          h.p(
            [h.Class('text-base text-muted')],
            [
              'Choose a recording of Japanese speech. It is cut into lines of a few seconds at its pauses, and each line’s pitch is found, so you can copy them one by one.',
            ],
          ),
        ],
      ),
      uploadPanel(page, events, h),
      packPanel(page, events, h),
    ],
    h,
  )
