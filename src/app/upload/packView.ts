import type { Html, HtmlBuilder } from 'foldkit/html'

import { FileDrop } from '@foldkit/ui'

import { uploadStatusAttribute } from './commands'
import { progressBar } from './progressBar'
import {
  PackJob,
  type UploadPage,
  acceptedFiles,
  canChooseFolder,
  packProgressOf,
  packStepText,
} from './upload'

// The local pack's part of /upload: pack.json and its audio files chosen
// or dropped together, or their folder chosen where the browser can,
// imported as one level, with a way to stop. It says plainly that the
// pack stays on this device and that its links are only links.

export type PackEvents<ViewMessage> = Readonly<{
  packDrop: (message: FileDrop.Message) => ViewMessage
  packFolder: (message: FileDrop.Message) => ViewMessage
  cancelPack: ViewMessage
}>

export const packPrivacySentence =
  'Your local pack stays on this device: nothing of it is sent anywhere, and the app never fetches its links. A line’s source opens only in a new tab, when you choose it.'

const packFiles: ReadonlyArray<string> = [
  'application/json',
  '.json',
  ...acceptedFiles,
]

const isBusy = (page: UploadPage): boolean =>
  page.job._tag === 'Working' || page.packJob._tag === 'Working'

const filesDrop = <ViewMessage>(
  page: UploadPage,
  events: PackEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.submodel({
    slotId: page.packDrop.id,
    model: page.packDrop,
    view: FileDrop.view,
    viewInputs: {
      accept: packFiles,
      multiple: true,
      isDisabled: isBusy(page),
      toView: attributes =>
        h.label(
          [
            ...attributes.root,
            h.Class(
              'flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-line bg-surface px-5 py-6 text-center hover:border-accent has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-accent data-[drag-over]:border-accent data-[drag-over]:bg-raised data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60',
            ),
          ],
          [
            h.span(
              [
                h.Class(
                  'inline-flex min-h-11 items-center justify-center rounded-md border border-line bg-raised px-5 py-2 text-center text-base font-semibold text-ink',
                ),
              ],
              ['Choose pack.json and its audio files'],
            ),
            h.span([h.Class('text-base text-ink')], ['or drop them here']),
            h.input(attributes.input),
          ],
        ),
    },
    toParentMessage: events.packDrop,
  })

// The folder's picker: a FileDrop whose input asks for a folder.
const folderButton = <ViewMessage>(
  page: UploadPage,
  events: PackEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.submodel({
    slotId: page.packFolder.id,
    model: page.packFolder,
    view: FileDrop.view,
    viewInputs: {
      accept: [],
      multiple: true,
      isDisabled: isBusy(page),
      toView: attributes =>
        h.label(
          [
            ...attributes.root,
            h.Class(
              `button-primary cursor-pointer self-start has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-accent data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60`,
            ),
          ],
          [
            'Choose the pack’s folder',
            h.input([...attributes.input, h.Attribute('webkitdirectory', '')]),
          ],
        ),
    },
    toParentMessage: events.packFolder,
  })

const working = <ViewMessage>(
  job: Extract<PackJob, { _tag: 'Working' }>,
  events: PackEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): ReadonlyArray<Html> => [
  h.p(
    [
      h.DataAttribute(uploadStatusAttribute, ''),
      h.Tabindex(-1),
      h.Class('text-base font-semibold focus:outline-none'),
    ],
    ['Importing the local pack'],
  ),
  progressBar(packProgressOf(job.step), 'Importing the local pack', h),
  h.p([h.Class('text-base text-ink')], [packStepText(job.step)]),
  h.button(
    [
      h.Type('button'),
      ...(job.step._tag === 'Keeping'
        ? [h.Disabled(true)]
        : [h.OnClick(events.cancelPack)]),
      h.Class('button-secondary self-start'),
    ],
    ['Stop'],
  ),
]

// What became of the last import, focused when it changes.
const outcome = <ViewMessage>(
  job: PackJob,
  h: HtmlBuilder<ViewMessage>,
): ReadonlyArray<Html> => {
  const said = (role: 'alert' | 'status', text: string) => [
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
    ),
  ]
  return PackJob.match(job, {
    Idle: () => [],
    Working: () => [],
    Refused: ({ reason }) =>
      said('alert', `The pack was not imported. ${reason}`),
    Cancelled: () => said('status', 'Stopped. Nothing of the pack was kept.'),
  })
}

export const packPanel = <ViewMessage>(
  page: UploadPage,
  events: PackEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.section(
    [h.AriaLabelledBy('pack-heading'), h.Class('card')],
    [
      h.h2(
        [h.Id('pack-heading'), h.Class('text-xl font-bold')],
        ['Import your local pack'],
      ),
      h.p(
        [h.Class('text-base text-ink')],
        [
          'A folder of your own recordings, with a pack.json that names each line’s file, times and text, imported as one level. Import it again after changing it: lines whose file and times are the same keep their takes.',
        ],
      ),
      h.p([h.Class('text-base text-muted')], [packPrivacySentence]),
      ...(page.packJob._tag === 'Working'
        ? working(page.packJob, events, h)
        : [
            ...(canChooseFolder ? [folderButton(page, events, h)] : []),
            filesDrop(page, events, h),
          ]),
      ...outcome(page.packJob, h),
    ],
  )
