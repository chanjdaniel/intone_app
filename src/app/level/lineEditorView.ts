import { Array, Option } from 'effect'
import type { Mount } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { peakHeight, peaksPerSecond } from '../../engine/audio/peaks'
import { type Edge, type Span, edgeLimits } from '../../engine/cut/edit'
import { clockText, preciseClockText } from '../line/lines'
import {
  type LineEditor,
  canChange,
  canSplitAtPlayhead,
  draftedSpans,
  editorWindow,
  keyStep,
  selectedIndexOf,
} from './editor'
import { lineEditorId } from './editorCommands'
import {
  edgeAttribute,
  lineBandAttribute,
  lineIdAttribute,
  windowFromAttribute,
  windowToAttribute,
} from './editorPointer'
import type { LevelChange, LevelClip, LevelLine } from './level'
import { levelLineTitle } from './level'
import { marksOf } from './lineMarks'

// The line editor (./editor.ts): the clip's waveform around the selected
// line, every line's span over it, the selected line's two edges as
// sliders to drag or step by key, the playhead as a third, and the
// changes a line can take. A slider says its time to a screen reader as
// it moves. The pointer on the waveform is followed by a Mount
// (./editorPointer.ts), `events.follow`.

export type LineEditorEvents<ViewMessage> = Readonly<{
  // A key's step, in seconds: added to where the edge or playhead is
  // when the Message arrives, so keys pressed faster than the screen
  // redraws each count.
  stepEdge: (lineId: string, edge: Edge, step: number) => ViewMessage
  stepPlayhead: (step: number) => ViewMessage
  select: (lineId: string) => ViewMessage
  play: ViewMessage
  stop: ViewMessage
  split: ViewMessage
  merge: (lineId: string, select: string) => ViewMessage
  remove: ViewMessage
  undo: ViewMessage
  follow: Mount.MountAction<ViewMessage>
  // Opens the editor, which reads the clip's audio.
  open: ViewMessage
}>

const buttonClass = `inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-line bg-surface px-4 text-base font-semibold text-ink hover:border-accent disabled:border-line disabled:text-muted focus-ring`

// Seconds as a share of the window, for a CSS left or width.
const percentIn = (shown: Span, seconds: number): number =>
  (100 * (seconds - shown.from)) / Math.max(1e-6, shown.to - shown.from)

const percentText = (value: number): string => `${value.toFixed(3)}%`

// The waveform's bars in the window, one per 10 ms, in a box of the
// window's bars wide and 100 high.
const waveformPath = (peaks: Uint8Array, shown: Span): string => {
  const first = Math.max(0, Math.floor(shown.from * peaksPerSecond))
  const last = Math.min(peaks.length, Math.ceil(shown.to * peaksPerSecond))
  return Array.makeBy(Math.max(0, last - first), k => {
    const half = Math.max(0.5, peakHeight(peaks[first + k] ?? 0) * 48)
    return `M${k + 0.5} ${(50 - half).toFixed(1)}V${(50 + half).toFixed(1)}`
  }).join('')
}

const changeWords = (change: LevelChange): string =>
  ({
    Moved: `Undo moving line ${change.lineNumber}’s edge`,
    Split: `Undo splitting line ${change.lineNumber}`,
    Merged: `Undo merging line ${change.lineNumber}`,
    Deleted: `Undo deleting line ${change.lineNumber}`,
  })[change.kind]

const edgeName = (edge: Edge): string => (edge === 'from' ? 'Start' : 'End')

const edgeSlider = <ViewMessage>(
  clip: LevelClip,
  editor: LineEditor,
  line: LevelLine,
  index: number,
  edge: Edge,
  seconds: number,
  shown: Span,
  events: LineEditorEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html => {
  const { least, most } = edgeLimits(clip.lines, index, edge, clip.seconds)
  const movable =
    editor.waveform._tag === 'Ready' && editor.saving._tag !== 'Saving'
  return h.div(
    [
      h.Role('slider'),
      h.Tabindex(0),
      h.AriaLabel(`${edgeName(edge)} of ${levelLineTitle(line)}`),
      h.AriaOrientation('horizontal'),
      h.AriaValuemin(Number(least.toFixed(2))),
      h.AriaValuemax(Number(most.toFixed(2))),
      h.AriaValuenow(Number(seconds.toFixed(2))),
      h.AriaValuetext(preciseClockText(seconds)),
      ...(movable ? [] : [h.AriaDisabled(true)]),
      h.DataAttribute(edgeAttribute, edge),
      h.DataAttribute(lineIdAttribute, line.id),
      h.Style({ left: percentText(percentIn(shown, seconds)) }),
      h.OnKeyDownPreventDefault((key, modifiers) =>
        movable
          ? Option.map(keyStep(key, modifiers), step =>
              events.stepEdge(line.id, edge, step),
            )
          : Option.none(),
      ),
      h.Class(
        `absolute inset-y-0 z-20 w-11 -translate-x-1/2 touch-none ${movable ? 'cursor-ew-resize' : 'cursor-not-allowed'} rounded-sm focus-ring`,
      ),
    ],
    [
      h.span([
        h.AriaHidden(true),
        h.Class(
          `absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 ${movable ? 'bg-accent' : 'bg-muted'}`,
        ),
      ]),
      h.span([
        h.AriaHidden(true),
        h.Class(
          `absolute top-1/2 left-1/2 h-9 w-3 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-surface ${movable ? 'bg-accent' : 'bg-muted'}`,
        ),
      ]),
    ],
  )
}

const playheadSlider = <ViewMessage>(
  clip: LevelClip,
  editor: LineEditor,
  shown: Span,
  events: LineEditorEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html => {
  const inView = editor.playhead >= shown.from && editor.playhead <= shown.to
  return h.div(
    [
      h.Role('slider'),
      h.Tabindex(0),
      h.AriaLabel('Playhead, where a play starts and a split falls'),
      h.AriaOrientation('horizontal'),
      h.AriaValuemin(0),
      h.AriaValuemax(Number(clip.seconds.toFixed(2))),
      h.AriaValuenow(Number(editor.playhead.toFixed(2))),
      h.AriaValuetext(preciseClockText(editor.playhead)),
      h.Style({
        left: percentText(
          Math.min(100, Math.max(0, percentIn(shown, editor.playhead))),
        ),
      }),
      h.OnKeyDownPreventDefault((key, modifiers) =>
        Option.map(keyStep(key, modifiers), step => events.stepPlayhead(step)),
      ),
      h.Class(
        `absolute inset-y-0 z-10 w-6 -translate-x-1/2 ${inView ? '' : 'opacity-0'} rounded-sm focus-ring`,
      ),
    ],
    [
      h.span([
        h.AriaHidden(true),
        h.Class('absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-ink'),
      ]),
      h.span([
        h.AriaHidden(true),
        h.Class(
          'absolute top-0 left-1/2 h-0 w-0 -translate-x-1/2 border-x-[7px] border-t-[9px] border-x-transparent border-t-ink',
        ),
      ]),
    ],
  )
}

const lineBand = <ViewMessage>(
  line: LevelLine,
  span: Span,
  selected: boolean,
  shown: Span,
  h: HtmlBuilder<ViewMessage>,
): Html => {
  const left = Math.max(0, percentIn(shown, span.from))
  const right = Math.min(100, percentIn(shown, span.to))
  return h.keyed('div')(
    line.id,
    [
      h.DataAttribute(lineBandAttribute, selected ? 'selected' : 'other'),
      h.DataAttribute(lineIdAttribute, line.id),
      h.AriaHidden(true),
      h.Style({
        left: percentText(left),
        width: percentText(Math.max(0, right - left)),
      }),
      h.Class(
        `absolute inset-y-0 ${selected ? 'bg-accent/15' : 'cursor-pointer bg-line/45 hover:bg-line/70'}`,
      ),
    ],
    [
      h.span(
        [
          h.Class(
            `absolute bottom-1 left-1.5 text-xs font-semibold ${selected ? 'text-accent' : 'text-muted'}`,
          ),
        ],
        [String(line.number)],
      ),
    ],
  )
}

const waveformFrame = <ViewMessage>(
  clip: LevelClip,
  editor: LineEditor,
  events: LineEditorEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html => {
  const shown = editorWindow(clip, editor)
  const spans = draftedSpans(clip, editor)
  const index = selectedIndexOf(clip, editor)
  const selected = clip.lines[index]
  const shownSpan = spans[index]
  const bands = clip.lines.flatMap((line, k) => {
    const span = spans[k] ?? line
    return span.to > shown.from && span.from < shown.to
      ? [lineBand(line, span, k === index, shown, h)]
      : []
  })
  return h.div(
    [h.Class('flex flex-col gap-1')],
    [
      h.div(
        [
          h.DataAttribute(windowFromAttribute, shown.from.toFixed(4)),
          h.DataAttribute(windowToAttribute, shown.to.toFixed(4)),
          h.OnMount(events.follow),
          h.Class(
            'relative h-36 w-full touch-pan-y overflow-hidden rounded-md border border-line bg-surface select-none',
          ),
        ],
        [
          ...bands,
          editor.waveform._tag === 'Ready'
            ? h.svg(
                [
                  h.AriaHidden(true),
                  h.ViewBox(
                    `0 0 ${Math.max(1, Math.round((shown.to - shown.from) * peaksPerSecond))} 100`,
                  ),
                  h.PreserveAspectRatio('none'),
                  h.Class(
                    'pointer-events-none absolute inset-0 h-full w-full text-native',
                  ),
                ],
                [
                  h.path([
                    h.D(waveformPath(editor.waveform.peaks, shown)),
                    h.Stroke('currentColor'),
                    h.StrokeWidth('0.7'),
                    h.Fill('none'),
                  ]),
                ],
              )
            : h.p(
                [
                  h.Class(
                    'pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-muted',
                  ),
                ],
                [
                  editor.waveform._tag === 'Opening'
                    ? 'Drawing the clip’s waveform…'
                    : 'The waveform could not be drawn.',
                ],
              ),
          playheadSlider(clip, editor, shown, events, h),
          ...(selected === undefined || shownSpan === undefined
            ? []
            : [
                edgeSlider(
                  clip,
                  editor,
                  selected,
                  index,
                  'from',
                  shownSpan.from,
                  shown,
                  events,
                  h,
                ),
                edgeSlider(
                  clip,
                  editor,
                  selected,
                  index,
                  'to',
                  shownSpan.to,
                  shown,
                  events,
                  h,
                ),
              ]),
        ],
      ),
      h.div(
        [
          h.AriaHidden(true),
          h.Class('flex justify-between text-xs text-muted tabular-nums'),
        ],
        [
          h.span([], [clockText(shown.from, true)]),
          h.span([], [clockText(shown.to, true)]),
        ],
      ),
    ],
  )
}

const marksPanel = <ViewMessage>(
  line: LevelLine,
  h: HtmlBuilder<ViewMessage>,
): ReadonlyArray<Html> =>
  Array.match(marksOf(line), {
    onEmpty: () => [],
    onNonEmpty: marks => [
      h.div(
        [
          h.Class(
            'flex flex-col gap-3 rounded-md border border-warn bg-surface p-4 text-base text-ink',
          ),
        ],
        marks.map(mark =>
          h.p(
            [],
            [
              h.strong(
                [h.Class('font-semibold text-warn')],
                [`${mark.name}. `],
              ),
              `${mark.why} ${mark.meaning}`,
            ],
          ),
        ),
      ),
    ],
  })

const noCurveText = (line: LevelLine): Option.Option<string> =>
  line.native === 'TooQuiet'
    ? Option.some('Too quiet to find its pitch, so it cannot be copied.')
    : line.native === 'TooNoisy'
      ? Option.some('Too noisy to find its pitch, so it cannot be copied.')
      : Option.none()

const statusText = (editor: LineEditor): string =>
  editor.saving._tag === 'Saving'
    ? 'Finding the pitch of the changed lines and keeping them…'
    : editor.waveform._tag === 'Opening'
      ? 'Getting the clip ready to change its lines…'
      : Option.getOrElse(editor.maybeNotice, () => '')

const alertText = (editor: LineEditor): string =>
  editor.saving._tag === 'Failed'
    ? `The change was not kept. ${editor.saving.reason}`
    : editor.waveform._tag === 'Failed'
      ? `The clip could not be opened to change its lines. ${editor.waveform.reason} Its lines can still be copied.`
      : ''

// The editor shut, as a level opens: opening it decodes the whole clip,
// which a level opened to practise never needs.
const closedEditorView = <ViewMessage>(
  clip: LevelClip,
  events: LineEditorEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.section(
    [
      h.Id(lineEditorId),
      h.Tabindex(-1),
      h.AriaLabelledBy('line-editor-heading'),
      h.Class(
        'flex flex-col gap-4 rounded-lg border border-line bg-raised p-4 focus:outline-none sm:p-6',
      ),
    ],
    [
      h.div(
        [h.Class('flex flex-col gap-1')],
        [
          h.h2(
            [h.Id('line-editor-heading'), h.Class('text-xl font-bold')],
            ['Fix the lines'],
          ),
          h.p(
            [h.Class('text-base text-muted')],
            [
              `Move a line’s edges, or split, merge or delete lines, if the cut missed. Opening the editor reads all ${clip.lines.length === 1 ? 'of the clip' : `${clip.lines.length} lines of the clip`}, which takes a moment on a long one.`,
            ],
          ),
        ],
      ),
      h.div(
        [],
        [
          h.button(
            [h.Type('button'), h.OnClick(events.open), h.Class(buttonClass)],
            ['Open the line editor'],
          ),
        ],
      ),
    ],
  )

export const lineEditorView = <ViewMessage>(
  clip: LevelClip,
  editor: LineEditor,
  events: LineEditorEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html => {
  if (editor.waveform._tag === 'Closed') {
    return closedEditorView(clip, events, h)
  }
  const index = selectedIndexOf(clip, editor)
  const line = clip.lines[index]
  const before = clip.lines[index - 1]
  const after = clip.lines[index + 1]
  const changing = canChange(editor)
  const splittable = changing && canSplitAtPlayhead(clip, editor)
  const playing = editor.play._tag === 'Playing'
  return h.section(
    [
      h.Id(lineEditorId),
      h.Tabindex(-1),
      h.AriaLabelledBy('line-editor-heading'),
      h.Class(
        'flex flex-col gap-4 rounded-lg border border-line bg-raised p-4 focus:outline-none sm:p-6',
      ),
    ],
    [
      h.div(
        [h.Class('flex flex-col gap-1')],
        [
          h.h2(
            [h.Id('line-editor-heading'), h.Class('text-xl font-bold')],
            ['Fix the lines'],
          ),
          h.p(
            [h.Class('text-base text-muted')],
            [
              'Drag a line’s edges, or select one and use the arrow keys, 10 ms a press or 100 ms with Shift. Tap the waveform to put the playhead there.',
            ],
          ),
        ],
      ),
      ...(line === undefined
        ? []
        : [
            h.div(
              [h.Class('flex flex-wrap items-center justify-between gap-3')],
              [
                h.p(
                  [h.Class('flex flex-col')],
                  [
                    h.span(
                      [h.Class('text-lg font-bold')],
                      [`${levelLineTitle(line)} of ${clip.lines.length}`],
                    ),
                    h.span(
                      [h.Class('text-sm text-muted tabular-nums')],
                      [
                        `${preciseClockText(line.from)} to ${preciseClockText(line.to)} · ${(line.to - line.from).toFixed(2)} s`,
                      ],
                    ),
                  ],
                ),
                h.div(
                  [h.Class('flex gap-2')],
                  [
                    h.button(
                      [
                        h.Type('button'),
                        h.Disabled(before === undefined),
                        ...(before === undefined
                          ? []
                          : [h.OnClick(events.select(before.id))]),
                        h.Class(buttonClass),
                      ],
                      [
                        h.span([h.AriaHidden(true)], ['←']),
                        before === undefined
                          ? 'Previous line'
                          : levelLineTitle(before),
                      ],
                    ),
                    h.button(
                      [
                        h.Type('button'),
                        h.Disabled(after === undefined),
                        ...(after === undefined
                          ? []
                          : [h.OnClick(events.select(after.id))]),
                        h.Class(buttonClass),
                      ],
                      [
                        after === undefined
                          ? 'Next line'
                          : levelLineTitle(after),
                        h.span([h.AriaHidden(true)], ['→']),
                      ],
                    ),
                  ],
                ),
              ],
            ),
            waveformFrame(clip, editor, events, h),
            ...Option.match(noCurveText(line), {
              onNone: () => [],
              onSome: text => [h.p([h.Class('text-base text-warn')], [text])],
            }),
            ...marksPanel(line, h),
            h.div(
              [h.Class('flex flex-wrap gap-2')],
              [
                h.button(
                  [
                    h.Type('button'),
                    h.OnClick(playing ? events.stop : events.play),
                    h.Class(buttonClass),
                  ],
                  [
                    playing
                      ? 'Stop'
                      : `Play ${levelLineTitle(line).toLowerCase()}`,
                  ],
                ),
                h.button(
                  [
                    h.Type('button'),
                    h.Disabled(!splittable),
                    ...(splittable ? [h.OnClick(events.split)] : []),
                    h.AriaDescribedBy('split-hint'),
                    h.Class(buttonClass),
                  ],
                  [`Split at ${preciseClockText(editor.playhead)}`],
                ),
                h.button(
                  [
                    h.Type('button'),
                    h.Disabled(before === undefined || !changing),
                    ...(before === undefined || !changing
                      ? []
                      : [h.OnClick(events.merge(before.id, before.id))]),
                    h.Class(buttonClass),
                  ],
                  [
                    before === undefined
                      ? 'Merge with the line before'
                      : `Merge with ${levelLineTitle(before).toLowerCase()}`,
                  ],
                ),
                h.button(
                  [
                    h.Type('button'),
                    h.Disabled(after === undefined || !changing),
                    ...(after === undefined || !changing
                      ? []
                      : [h.OnClick(events.merge(line.id, line.id))]),
                    h.Class(buttonClass),
                  ],
                  [
                    after === undefined
                      ? 'Merge with the line after'
                      : `Merge with ${levelLineTitle(after).toLowerCase()}`,
                  ],
                ),
                h.button(
                  [
                    h.Type('button'),
                    h.Disabled(clip.lines.length < 2 || !changing),
                    ...(clip.lines.length < 2 || !changing
                      ? []
                      : [h.OnClick(events.remove)]),
                    h.Class(buttonClass),
                  ],
                  [`Delete ${levelLineTitle(line).toLowerCase()}`],
                ),
                ...Option.match(clip.maybeUndo, {
                  onNone: () => [],
                  onSome: change => [
                    h.button(
                      [
                        h.Type('button'),
                        h.Disabled(
                          editor.saving._tag === 'Saving' ||
                            Option.isSome(editor.maybeDraft),
                        ),
                        h.OnClick(events.undo),
                        h.Class(buttonClass),
                      ],
                      [changeWords(change)],
                    ),
                  ],
                }),
              ],
            ),
            h.p(
              [h.Id('split-hint'), h.Class('text-sm text-muted')],
              [
                splittable
                  ? `Splits ${levelLineTitle(line).toLowerCase()} in two at the playhead.`
                  : 'To split the line, put the playhead inside it, at least a quarter second from its edges.',
              ],
            ),
          ]),
      h.p(
        [h.Role('status'), h.Class('text-base text-ink empty:hidden')],
        [statusText(editor)],
      ),
      h.p(
        [
          h.Role('alert'),
          h.Class('text-base text-bad break-words empty:hidden'),
        ],
        [alertText(editor)],
      ),
    ],
  )
}
