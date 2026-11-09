import { Array, Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { Dialog } from '@foldkit/ui'

import { countText } from '../history/format'
import { pageFrame } from '../history/historyView'
import { clockText } from '../line/lines'
import { sourceLink } from '../line/sourceLink'
import { homeRouter, lineRouter } from '../route'
import { levelRowAttribute } from './commands'
import {
  type DeleteState,
  type LevelClip,
  type LevelLine,
  LevelPage,
  LevelStars,
  levelFindFromRows,
  levelLineTitle,
  levelLinesFound,
  levelRowsPerPage,
} from './level'
import { type LineEditorEvents, lineEditorView } from './lineEditorView'
import { marksOf } from './lineMarks'
import type { StarCount } from './progress'
import { starRow, starRules } from './starRow'

// /level/:clipId: a clip's lines in order, each with its stars, in the
// app's one frame for a long list (spec, "Frontend patterns applied"): a
// find field once there are more than 12, a count line, the first 50
// rows and "Show N more", the find words in the address. Each line with
// a native curve opens its practice screen; each line of an upload can
// be chosen in the line editor above the list (./lineEditorView.ts) to
// fix where it starts and ends; a line with a mark says why. The
// learner's clip can be deleted with everything of it, behind a
// confirming dialog; a clip the app brings cannot.

export type LevelEvents<ViewMessage> = Readonly<{
  changedWords: (words: string) => ViewMessage
  showMore: ViewMessage
  editLine: (lineId: string) => ViewMessage
  editor: LineEditorEvents<ViewMessage>
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

// What a level is called where it is deleted: a clip, or a local pack.
const nounOf = (clip: LevelClip): string =>
  clip.origin === 'Pack' ? 'pack' : 'clip'

// A line's stars, once the level's are read: none for a line with no
// take yet.
export const starsOfLine = (
  stars: LevelStars,
  lineId: string,
): StarCount | null =>
  stars._tag === 'Ready'
    ? (stars.lines.find(line => line.lineId === lineId)?.progress.stars ?? 0)
    : null

// How long a clip is: in seconds under a minute, else as on a clock.
export const lengthText = (seconds: number): string =>
  seconds < 60 ? `${seconds.toFixed(1)} s` : clockText(seconds)

// A line's length in tenths of a second, read down as its times are, so
// a line shown from 0:00.0 to 0:01.2 is 1.2 s long, never 1.3.
const tenthsText = (seconds: number): string =>
  (Math.floor(seconds * 10 + 1e-6) / 10).toFixed(1)

// Where a line is: its file in a local pack, its times and its length;
// and its name too when its text is its title.
const lineDetail = (line: LevelLine): string =>
  [
    ...(Option.isSome(line.maybeText) ? [levelLineTitle(line)] : []),
    ...Option.toArray(line.maybeFile),
    `${clockText(line.from, true)} to ${clockText(line.to, true)}`,
    `${tenthsText(line.to - line.from)} s`,
  ].join(' · ')

// Why a line cannot be copied, if it cannot.
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
      ...Option.match(line.maybeText, {
        onNone: () => [
          h.span([h.Class('text-xl font-bold')], [levelLineTitle(line)]),
        ],
        onSome: text => [
          h.span(
            [h.Lang('ja'), h.Class('text-xl font-bold break-words')],
            [text],
          ),
        ],
      }),
      ...Option.match(line.maybeKana, {
        onNone: () => [],
        onSome: kana => [
          h.span([h.Class('sr-only')], [', ']),
          h.span(
            [h.Lang('ja'), h.Class('text-base text-muted break-words')],
            [kana],
          ),
        ],
      }),
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
      ...marksOf(line).flatMap(mark => [
        h.span([h.Class('sr-only')], [', ']),
        h.span([h.Class('text-sm text-warn')], [`${mark.name}: ${mark.why}`]),
      ]),
    ],
  ),
]

// A line's row: its name, where it is, its stars and any mark, the whole
// row a link to its practice screen when it can be copied.
export const levelRow = <ViewMessage>(
  clipId: string,
  hasAudio: boolean,
  line: LevelLine,
  stars: StarCount | null,
  index: number,
  editLine: ((lineId: string) => ViewMessage) | null,
  h: HtmlBuilder<ViewMessage>,
): Html => {
  const maybeWhy = unplayable(line, hasAudio)
  const starsShown = stars === null ? [] : [starRow(stars, h)]
  const rowClass =
    'flex min-h-11 min-w-0 flex-1 items-center justify-between gap-4 rounded-lg border border-line bg-raised px-4 py-3 text-ink'
  const row = h.div(
    [h.Class('flex items-stretch gap-2')],
    [
      Option.isSome(maybeWhy)
        ? h.div(
            [
              h.DataAttribute(levelRowAttribute, String(index)),
              h.Tabindex(-1),
              h.Class(`${rowClass} focus:outline-none`),
            ],
            [...lineRowBody(line, maybeWhy, h), ...starsShown],
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
                [h.Class('flex shrink-0 flex-col items-end gap-1')],
                [
                  ...starsShown,
                  h.span(
                    [
                      h.AriaHidden(true),
                      h.Class('text-base font-semibold text-accent'),
                    ],
                    ['Copy →'],
                  ),
                ],
              ),
            ],
          ),
      ...(editLine === null
        ? []
        : [
            h.button(
              [
                h.Type('button'),
                h.AriaLabel(`Fix ${levelLineTitle(line).toLowerCase()}`),
                h.OnClick(editLine(line.id)),
                h.Class(
                  `inline-flex min-h-11 shrink-0 items-center rounded-lg border border-line bg-surface px-4 text-base font-semibold text-ink hover:border-accent ${focusRing}`,
                ),
              ],
              ['Fix'],
            ),
          ]),
    ],
  )
  // A source link cannot be inside the row's own link, so it is under it.
  return h.keyed('li')(
    line.id,
    [h.Class('flex flex-col gap-1')],
    [
      row,
      ...Option.match(line.maybeSource, {
        onNone: () => [],
        onSome: source => [
          h.div([h.Class('flex px-4')], [sourceLink(source, h)]),
        ],
      }),
    ],
  )
}

const countLine = (found: number, all: number, words: string): string =>
  words.trim() === ''
    ? countText(all, 'line')
    : `${countText(found, 'line')} of ${all} found for “${words.trim()}”`

export const levelLineList = <ViewMessage>(
  clip: LevelClip,
  stars: LevelStars,
  words: string,
  shownRows: number,
  events: Pick<LevelEvents<ViewMessage>, 'changedWords' | 'showMore'> &
    Partial<Pick<LevelEvents<ViewMessage>, 'editLine'>>,
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
          levelRow(
            clip.id,
            clip.hasAudio,
            line,
            starsOfLine(stars, line.id),
            index,
            clip.hasAudio && clip.origin === 'Upload'
              ? (events.editLine ?? null)
              : null,
            h,
          ),
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
                        clip.origin === 'Pack'
                          ? `The pack’s ${countText(clip.lines.length, 'line')}, their audio, their curves and every take of them will be deleted from this device. Your files in local/ stay where they are. This cannot be undone.`
                          : `The clip, its ${countText(clip.lines.length, 'line')}, their curves and every take of them will be deleted from this device. This cannot be undone.`,
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
                          [`Keep the ${nounOf(clip)}`],
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
                              : `Delete the ${nounOf(clip)}`,
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
          [
            ...(clip.origin === 'Bundled' ? [h.Lang('ja')] : []),
            h.Class('text-3xl font-bold break-words sm:text-5xl'),
          ],
          [clip.name],
        ),
        h.p([h.Class('text-base text-muted')], [aboutText(clip)]),
      ],
    ),
    starsSummary(clip, page.stars, h),
    ...(clip.hasAudio
      ? []
      : [
          statusBox(
            clip.origin === 'Pack'
              ? 'This pack came from a backup that left its audio out, so its lines cannot be played. Import the pack again to practise them.'
              : 'This clip came from a backup that left its audio out, so its lines cannot be played. Bring the file again to practise them.',
            'status',
            h,
          ),
        ]),
    ...(clip.hasAudio && clip.origin === 'Upload'
      ? [lineEditorView(clip, page.editor, events.editor, h)]
      : []),
    h.section(
      [h.AriaLabelledBy('level-lines-heading'), h.Class('flex flex-col gap-4')],
      [
        h.h2(
          [h.Id('level-lines-heading'), h.Class('text-xl font-bold')],
          ['Lines to copy'],
        ),
        levelLineList(clip, page.stars, words, page.shownRows, events, h),
      ],
    ),
    ...(clip.origin === 'Bundled'
      ? []
      : [
          deleteSection(clip, events, h),
          deleteDialogView(dialog, clip, page.deleting, events, h),
        ]),
  ]
}

const deleteSection = <ViewMessage>(
  clip: LevelClip,
  events: LevelEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html =>
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
        [`Delete this ${nounOf(clip)}`],
      ),
      h.p(
        [h.Class('text-base text-ink')],
        [
          clip.origin === 'Pack'
            ? 'Deletes the pack from this device with its lines, their audio, their curves and your takes of them. Your files in local/ stay where they are.'
            : 'Deletes the clip from this device with its lines, their curves and your takes of them.',
        ],
      ),
      h.button(
        [
          h.Type('button'),
          h.OnClick(events.deleteClip),
          h.Class(`${dangerButton} self-start`),
        ],
        [`Delete this ${nounOf(clip)}`],
      ),
    ],
  )

// What the level is and where its lines are kept.
const aboutText = (clip: LevelClip): string => {
  const lines = countText(clip.lines.length, 'line')
  return clip.origin === 'Bundled'
    ? `${lines}, bundled with the app.`
    : clip.origin === 'Pack'
      ? `${lines} from your local pack, kept on this device. To change them, change its pack.json and import it again.`
      : `${lines} from ${lengthText(clip.seconds)} of audio, kept on this device.`
}

// The level's stars together, out of three a line, and how each is
// earned; or why they could not be read.
const starsSummary = <ViewMessage>(
  clip: LevelClip,
  stars: LevelStars,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  LevelStars.match(stars, {
    Loading: () => h.empty,
    Failed: ({ reason }) =>
      h.p(
        [h.Role('alert'), h.Class('text-base text-bad break-words')],
        [`Your stars could not be read. ${reason}`],
      ),
    Ready: ({ lines }) =>
      h.section(
        [
          h.AriaLabelledBy('level-stars-heading'),
          h.Class(
            'flex flex-col gap-2 rounded-lg border border-line bg-raised p-4 sm:p-5',
          ),
        ],
        [
          h.h2(
            [
              h.Id('level-stars-heading'),
              h.Class('text-lg font-bold tabular-nums'),
            ],
            [
              `${lines.reduce((sum, line) => sum + line.progress.stars, 0)} of ${3 * clip.lines.length} stars`,
            ],
          ),
          h.ul(
            [h.Class('flex flex-col gap-0.5 text-sm text-muted')],
            starRules().map(rule => h.li([], [rule])),
          ),
        ],
      ),
  })

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
