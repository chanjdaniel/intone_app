import { Array, Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { Dialog } from '@foldkit/ui'

import { countText } from '../history/format'
import { pageFrame } from '../history/historyView'
import { clipLineTitle, clockText } from '../line/lines'
import { homeRouter, lineRouter } from '../route'
import { levelRowAttribute } from './commands'
import {
  type DeleteState,
  type LevelClip,
  type LevelLine,
  LevelPage,
  levelFindFromRows,
  levelLinesFound,
  levelRowsPerPage,
} from './level'

// /level/:clipId: a clip's lines in order, in the app's one frame for a
// long list (spec, "Frontend patterns applied"): a find field once there
// are more than 12, a count line, the first 50 rows and "Show N more",
// the find words in the address. Each line with a native curve opens its
// practice screen. The clip can be deleted with everything of it, behind
// a confirming dialog.

export type LevelEvents<ViewMessage> = Readonly<{
  changedWords: (words: string) => ViewMessage
  showMore: ViewMessage
  deleteClip: ViewMessage
  keepClip: ViewMessage
  confirmDelete: ViewMessage
  dialog: (message: Dialog.Message) => ViewMessage
}>

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
const buttonBase = `inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-5 text-base font-semibold ${focusRing}`
const secondaryButton = `${buttonBase} border border-line bg-surface text-ink disabled:text-muted`
const dangerButton = `${buttonBase} bg-bad text-on-accent disabled:opacity-60`

export const levelFindInputId = 'find-level-lines'

export const lengthText = (seconds: number): string =>
  seconds < 60 ? `${seconds.toFixed(1)} s` : `${clockText(seconds)} long`

const lineDetail = (line: LevelLine): string =>
  `${clockText(line.from, true)} to ${clockText(line.to, true)} · ${(line.to - line.from).toFixed(1)} s`

const unplayable = (
  line: LevelLine,
  hasAudio: boolean,
): Option.Option<string> =>
  !hasAudio
    ? Option.some('Its audio is not on this device')
    : line.native === 'TooQuiet'
      ? Option.some('Too quiet to find its pitch')
      : line.native === 'TooNoisy'
        ? Option.some('Too noisy to find its pitch')
        : Option.none()

const lineRowBody = <ViewMessage>(
  line: LevelLine,
  maybeWhy: Option.Option<string>,
  h: HtmlBuilder<ViewMessage>,
): ReadonlyArray<Html> => [
  h.span(
    [h.Class('flex min-w-0 flex-col gap-0.5')],
    [
      h.span([h.Class('text-xl font-bold')], [clipLineTitle(line)]),
      // NOTE: a row's lines are one link's name; this keeps a pause
      // between them for a screen reader.
      h.span([h.Class('sr-only')], [', ']),
      h.span([h.Class('text-sm text-muted')], [lineDetail(line)]),
      ...Option.match(maybeWhy, {
        onNone: () => [],
        onSome: why => [
          h.span([h.Class('sr-only')], [', ']),
          h.span([h.Class('text-sm text-warn')], [why]),
        ],
      }),
    ],
  ),
]

const lineRow = <ViewMessage>(
  clipId: string,
  hasAudio: boolean,
  line: LevelLine,
  index: number,
  h: HtmlBuilder<ViewMessage>,
): Html => {
  const maybeWhy = unplayable(line, hasAudio)
  const rowClass =
    'flex min-h-11 items-center justify-between gap-4 rounded-lg border border-line bg-raised px-4 py-3 text-ink'
  return h.keyed('li')(
    line.id,
    [],
    [
      Option.isSome(maybeWhy)
        ? h.div(
            [
              h.DataAttribute(levelRowAttribute, String(index)),
              h.Tabindex(-1),
              h.Class(`${rowClass} focus:outline-none`),
            ],
            lineRowBody(line, maybeWhy, h),
          )
        : h.a(
            [
              h.Href(lineRouter({ clipId, lineId: line.id })),
              h.DataAttribute(levelRowAttribute, String(index)),
              h.Class(`${rowClass} hover:border-accent ${focusRing}`),
            ],
            [
              ...lineRowBody(line, maybeWhy, h),
              h.span(
                [
                  h.AriaHidden(true),
                  h.Class('shrink-0 text-base font-semibold text-accent'),
                ],
                ['Copy →'],
              ),
            ],
          ),
    ],
  )
}

const countLine = (found: number, all: number, words: string): string =>
  words.trim() === ''
    ? countText(all, 'line')
    : `${countText(found, 'line')} of ${all} found for “${words.trim()}”`

export const levelLineList = <ViewMessage>(
  clip: LevelClip,
  words: string,
  shownRows: number,
  events: Pick<LevelEvents<ViewMessage>, 'changedWords' | 'showMore'>,
  h: HtmlBuilder<ViewMessage>,
): Html => {
  const found = levelLinesFound(clip.lines, words)
  const shown = Array.take(found, shownRows)
  const more = Math.min(levelRowsPerPage, found.length - shown.length)
  return h.div(
    [h.Class('flex flex-col gap-3')],
    [
      ...(clip.lines.length > levelFindFromRows
        ? [
            h.div(
              [h.Class('flex flex-col gap-1')],
              [
                h.label(
                  [h.For(levelFindInputId), h.Class('text-base font-semibold')],
                  ['Find a line'],
                ),
                h.input([
                  h.Id(levelFindInputId),
                  h.Type('search'),
                  h.Value(words),
                  h.Placeholder('A line’s number or time, such as 12 or 1:05'),
                  h.Autocomplete('off'),
                  h.Spellcheck(false),
                  h.OnInput(events.changedWords),
                  h.Class(
                    `min-h-11 w-full rounded-md border border-line bg-surface px-3 text-base text-ink placeholder:text-muted ${focusRing}`,
                  ),
                ]),
              ],
            ),
          ]
        : []),
      h.p(
        [h.Role('status'), h.Class('text-sm text-muted')],
        [countLine(found.length, clip.lines.length, words)],
      ),
      h.ul(
        [h.Class('flex flex-col gap-2')],
        shown.map((line, index) =>
          lineRow(clip.id, clip.hasAudio, line, index, h),
        ),
      ),
      ...(more > 0
        ? [
            h.button(
              [
                h.Type('button'),
                h.OnClick(events.showMore),
                h.Class(`${secondaryButton} self-start`),
              ],
              [`Show ${more} more`],
            ),
          ]
        : []),
    ],
  )
}

// The confirming dialog: the frontend patterns' narrow width for two
// controls, with the body, the error and the actions in one form, so
// Enter confirms.
const deleteDialogView = <ViewMessage>(
  dialog: Dialog.Model,
  clip: LevelClip,
  deleting: DeleteState,
  events: LevelEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.submodel({
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
                    h.OnSubmit(events.confirmDelete),
                    h.Class(
                      'relative flex w-[min(100%-2rem,26rem)] flex-col gap-4 rounded-lg border border-line bg-surface p-6 text-ink shadow-lg',
                    ),
                  ],
                  [
                    h.h2(
                      [...title, h.Class('text-xl font-bold break-words')],
                      [`Delete ${clip.name}?`],
                    ),
                    h.p(
                      [...description, h.Class('text-base text-ink')],
                      [
                        `The clip, its ${countText(clip.lines.length, 'line')}, their curves and every take of them will be deleted from this device. This cannot be undone.`,
                      ],
                    ),
                    h.p(
                      [
                        h.Role('alert'),
                        h.Class('text-base text-bad empty:hidden'),
                      ],
                      [
                        deleting._tag === 'Failed'
                          ? `Nothing was deleted. ${deleting.reason}`
                          : '',
                      ],
                    ),
                    h.div(
                      [h.Class('flex flex-wrap justify-end gap-3')],
                      [
                        h.button(
                          [
                            ...initialFocus,
                            h.Type('button'),
                            h.OnClick(events.keepClip),
                            h.Class(secondaryButton),
                          ],
                          ['Keep the clip'],
                        ),
                        h.button(
                          [
                            h.Type('submit'),
                            ...(deleting._tag === 'Deleting'
                              ? [h.Disabled(true)]
                              : []),
                            h.Class(dangerButton),
                          ],
                          [
                            deleting._tag === 'Deleting'
                              ? 'Deleting…'
                              : 'Delete the clip',
                          ],
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

const statusBox = <ViewMessage>(
  text: string,
  role: 'status' | 'alert',
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.p(
    [
      h.Role(role),
      h.Class(
        `rounded-lg border border-line bg-raised p-5 text-base break-words ${role === 'alert' ? 'text-bad' : 'text-muted'}`,
      ),
    ],
    [text],
  )

const backLink = <ViewMessage>(h: HtmlBuilder<ViewMessage>): Html =>
  h.nav(
    [h.AriaLabel('Back')],
    [
      h.a(
        [
          h.Href(homeRouter()),
          h.Class(
            `inline-flex min-h-11 items-center gap-1.5 self-start rounded-md text-accent ${focusRing}`,
          ),
        ],
        [
          h.span([h.AriaHidden(true)], ['←']),
          h.span([h.Class('underline underline-offset-4')], ['All lines']),
        ],
      ),
    ],
  )

const readyBody = <ViewMessage>(
  page: Extract<LevelPage, { _tag: 'Ready' }>,
  words: string,
  dialog: Dialog.Model,
  events: LevelEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): ReadonlyArray<Html> => {
  const { clip } = page
  return [
    h.header(
      [h.Class('flex flex-col gap-2')],
      [
        h.h1(
          [h.Class('text-3xl font-bold break-words sm:text-5xl')],
          [clip.name],
        ),
        h.p(
          [h.Class('text-base text-muted')],
          [
            `${countText(clip.lines.length, 'line')} from ${lengthText(clip.seconds)} of audio, kept on this device.`,
          ],
        ),
      ],
    ),
    ...(clip.hasAudio
      ? []
      : [
          statusBox(
            'This clip came from a backup that left its audio out, so its lines cannot be played. Bring the file again to practise them.',
            'status',
            h,
          ),
        ]),
    h.section(
      [h.AriaLabelledBy('level-lines-heading'), h.Class('flex flex-col gap-4')],
      [
        h.h2(
          [h.Id('level-lines-heading'), h.Class('text-xl font-bold')],
          ['Lines to copy'],
        ),
        levelLineList(clip, words, page.shownRows, events, h),
      ],
    ),
    h.section(
      [
        h.AriaLabelledBy('delete-clip-heading'),
        h.Class(
          'flex flex-col gap-4 rounded-lg border border-line bg-raised p-5 sm:p-6',
        ),
      ],
      [
        h.h2(
          [h.Id('delete-clip-heading'), h.Class('text-xl font-bold')],
          ['Delete this clip'],
        ),
        h.p(
          [h.Class('text-base text-ink')],
          [
            'Deletes the clip from this device with its lines, their curves and your takes of them.',
          ],
        ),
        h.button(
          [
            h.Type('button'),
            h.OnClick(events.deleteClip),
            h.Class(`${dangerButton} self-start`),
          ],
          ['Delete this clip'],
        ),
      ],
    ),
    deleteDialogView(dialog, clip, page.deleting, events, h),
  ]
}

export const levelView = <ViewMessage>(
  page: LevelPage,
  maybeFind: Option.Option<string>,
  dialog: Dialog.Model,
  events: LevelEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html => {
  const reading = (): ReadonlyArray<Html> => [
    statusBox('Reading the clip from this device.', 'status', h),
  ]
  const body = LevelPage.match<ReadonlyArray<Html>>(page, {
    NotLoaded: reading,
    Loading: reading,
    Missing: () => [
      h.h1([h.Class('text-3xl font-bold sm:text-5xl')], ['No such clip']),
      statusBox(
        'This device has no clip at this address. It may have been deleted.',
        'status',
        h,
      ),
    ],
    Failed: ({ reason }) => [
      statusBox(`The clip could not be read. ${reason}`, 'alert', h),
    ],
    Ready: ready =>
      readyBody(
        ready,
        Option.getOrElse(maybeFind, () => ''),
        dialog,
        events,
        h,
      ),
  })
  return pageFrame('Lines', [backLink(h), ...body], h)
}
