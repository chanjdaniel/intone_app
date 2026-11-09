import { Option, Schema } from 'effect'
import { Runtime, type Update } from 'foldkit'
import { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { onSampleGrid } from '../../../engine/cut/edit'
import { LineEdit, planEdit, undoneOf } from '../../../services/clip-edits'
import { ClipEntry } from '../../../services/history-records'
import {
  ClipWaveform,
  EdgeName,
  LevelPlay,
  type LineEditor,
  LineEditor as LineEditorSchema,
  clampedEdge,
  edgeSecondsOf,
  initialEditor,
  selectedIndexOf,
} from '../../level/editor'
import { defineFollowLineEditorPointer } from '../../level/editorPointer'
import { levelClipOf } from '../../level/level'
import { lineEditorView } from '../../level/lineEditorView'
import { preciseClockText } from '../../line/lines'
import { type DevEntry, buttonFocusClass, entryFrame } from '../entry'
import {
  cutStudyEntry,
  cutStudyPeaks,
  musicStudyEntry,
  musicStudyPeaks,
} from '../sampleClips'

// The line editor on the cut study's clip (docs/cut-study.md): its real
// waveform and lines, clean or over the study's music bed, whose lines
// carry the marks. Every edge drags and steps; the changes apply at once
// through the history's own planning (src/services/clip-edits.ts), where
// the app would track the moved lines again first, so a line changed
// here has a curve but no quality yet. Nothing plays here: the library
// has no clip on the device.

// MODEL

export const Model = Schema.Struct({
  clip: ClipEntry,
  editor: LineEditorSchema,
  // What the app would have done last.
  maybeAsked: Schema.Option(Schema.String),
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  ClickedClip: { music: Schema.Boolean },
  MovedEdge: {
    lineId: Schema.String,
    edge: EdgeName,
    seconds: Schema.Finite,
    by: Schema.Literals(['Pointer', 'Keyboard']),
  },
  SteppedEdge: { lineId: Schema.String, edge: EdgeName, step: Schema.Finite },
  SteppedPlayhead: { step: Schema.Finite },
  ReleasedEdge: {},
  PlacedPlayhead: { seconds: Schema.Finite },
  SelectedLine: { lineId: Schema.String },
  ClickedPlay: {},
  ClickedStop: {},
  ClickedSplit: {},
  ClickedMerge: { lineId: Schema.String, select: Schema.String },
  ClickedDelete: {},
  ClickedUndo: {},
  CompletedFollowPointer: {},
})
export type Message = typeof Message.Type

// INIT

const opened = (clip: ClipEntry, peaks: Uint8Array): Model => ({
  clip,
  editor: {
    ...initialEditor(levelClipOf(clip)),
    waveform: ClipWaveform.Ready({ peaks }),
  },
  maybeAsked: Option.none(),
})

export const init: Runtime.ElementInit<Model, Message> = () => ({
  model: opened(cutStudyEntry, cutStudyPeaks),
})

// UPDATE

// `edit` applied as the history plans it, each line it moves given a
// curve as if tracked again, and `select` selected after.
const applied = (
  model: Model,
  edit: LineEdit,
  select: (clip: ClipEntry) => string,
  asked: string,
): Model =>
  Option.match(planEdit(model.clip, edit), {
    onNone: () =>
      modifyFields(model, {
        editor: editor =>
          modifyFields(editor, { maybeDraft: () => Option.none() }),
      }),
    onSome: plan => {
      const clip: ClipEntry = {
        format: model.clip.format,
        id: model.clip.id,
        name: model.clip.name,
        addedAt: model.clip.addedAt,
        seconds: model.clip.seconds,
        audio: model.clip.audio,
        lines: plan.lines.map(line =>
          line._tag === 'Kept'
            ? line.line
            : {
                id: line.id,
                from: line.from,
                to: line.to,
                native: { _tag: 'Tracked', nativeId: `retracked-${line.id}` },
              },
        ),
        nextLineId: plan.nextLineId,
        undo: plan.undo,
      }
      return modifyFields(model, {
        clip: () => clip,
        editor: editor =>
          modifyFields(editor, {
            selectedId: () => select(clip),
            maybeDraft: () => Option.none(),
            play: () => LevelPlay.Stopped(),
            maybeNotice: () => Option.some(asked),
          }),
        maybeAsked: () => Option.some(asked),
      })
    },
  })

const keepDraft = (model: Model): Model =>
  Option.match(model.editor.maybeDraft, {
    onNone: () => model,
    onSome: draft =>
      applied(
        model,
        {
          _tag: 'Move',
          lineId: draft.lineId,
          edge: draft.edge,
          seconds: draft.seconds,
        },
        () => draft.lineId,
        `Kept line ${selectedIndexOf(levelClipOf(model.clip), { selectedId: draft.lineId }) + 1}’s ${draft.edge === 'from' ? 'start' : 'end'} at ${preciseClockText(draft.seconds)}; the app tracks it again first.`,
      ),
  })

const withEditor = (
  model: Model,
  change: (editor: LineEditor) => LineEditor,
): Model => modifyFields(model, { editor: change })

// An edge moved, as a draft; the keys' kept at once, since nothing here
// is tracked again.
const movedEdge = (
  model: Model,
  lineId: string,
  edge: 'from' | 'to',
  seconds: number,
  by: 'Pointer' | 'Keyboard',
): Model => {
  const drafted = withEditor(model, editor =>
    modifyFields(editor, {
      maybeDraft: () =>
        Option.some({
          lineId,
          edge,
          seconds: clampedEdge(levelClipOf(model.clip), lineId, edge, seconds),
          draftNumber: editor.draftsMade + 1,
          by,
        }),
      draftsMade: made => made + 1,
    }),
  )
  return by === 'Keyboard' ? keepDraft(drafted) : drafted
}

const placed = (model: Model, seconds: number): Model =>
  withEditor(model, editor =>
    modifyFields(editor, {
      playhead: () =>
        Math.min(model.clip.seconds, Math.max(0, onSampleGrid(seconds))),
    }),
  )

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    ClickedClip: ({ music }) => ({
      model: music
        ? opened(musicStudyEntry, musicStudyPeaks)
        : opened(cutStudyEntry, cutStudyPeaks),
    }),
    MovedEdge: ({ lineId, edge, seconds, by }) => ({
      model: movedEdge(model, lineId, edge, seconds, by),
    }),
    SteppedEdge: ({ lineId, edge, step }) => {
      const clip = levelClipOf(model.clip)
      const line = clip.lines.find(found => found.id === lineId)
      return {
        model:
          line === undefined
            ? model
            : movedEdge(
                model,
                lineId,
                edge,
                edgeSecondsOf(clip, model.editor, line, edge) + step,
                'Keyboard',
              ),
      }
    },
    ReleasedEdge: () => ({ model: keepDraft(model) }),
    PlacedPlayhead: ({ seconds }) => ({ model: placed(model, seconds) }),
    SteppedPlayhead: ({ step }) => ({
      model: placed(model, model.editor.playhead + step),
    }),
    SelectedLine: ({ lineId }) => ({
      model: withEditor(model, editor =>
        modifyFields(editor, {
          selectedId: () => lineId,
          playhead: playhead =>
            model.clip.lines.find(line => line.id === lineId)?.from ?? playhead,
          maybeNotice: () => Option.none(),
        }),
      ),
    }),
    ClickedPlay: () => ({
      model: withEditor(model, editor =>
        modifyFields(editor, {
          play: () =>
            LevelPlay.Playing({
              playNumber: 1,
              from: editor.playhead,
              to: editor.playhead,
            }),
        }),
      ),
    }),
    ClickedStop: () => ({
      model: withEditor(model, editor =>
        modifyFields(editor, { play: () => LevelPlay.Stopped() }),
      ),
    }),
    ClickedSplit: () => ({
      model: applied(
        model,
        {
          _tag: 'Split',
          lineId: model.editor.selectedId,
          seconds: model.editor.playhead,
        },
        () => model.editor.selectedId,
        `Split at ${preciseClockText(model.editor.playhead)}; the app tracks both parts again first.`,
      ),
    }),
    ClickedMerge: ({ lineId, select }) => ({
      model: applied(
        model,
        { _tag: 'Merge', lineId },
        () => select,
        'Merged; the app tracks the merged line again first.',
      ),
    }),
    ClickedDelete: () => {
      const index = selectedIndexOf(levelClipOf(model.clip), model.editor)
      return {
        model: applied(
          model,
          { _tag: 'Delete', lineId: model.editor.selectedId },
          clip => clip.lines[Math.min(index, clip.lines.length - 1)]?.id ?? '',
          'Deleted; its takes would be kept in the history.',
        ),
      }
    },
    ClickedUndo: () => ({
      model: Option.match(undoneOf(model.clip), {
        onNone: () => model,
        onSome: clip =>
          modifyFields(model, {
            clip: () => clip,
            editor: editor =>
              modifyFields(editor, {
                selectedId: selected =>
                  clip.lines.some(line => line.id === selected)
                    ? selected
                    : (clip.lines[0]?.id ?? ''),
                maybeNotice: () => Option.some('The last change is undone.'),
              }),
            maybeAsked: () =>
              Option.some('Undone, with the curves kept for it.'),
          }),
      }),
    }),
    CompletedFollowPointer: () => ({ model }),
  })

// VIEW

export const FollowPointer = defineFollowLineEditorPointer(
  [
    Message.MovedEdge,
    Message.ReleasedEdge,
    Message.PlacedPlayhead,
    Message.SelectedLine,
    Message.CompletedFollowPointer,
  ],
  {
    moved: (lineId, edge, seconds) =>
      Message.MovedEdge({ lineId, edge, seconds, by: 'Pointer' }),
    released: () => Message.ReleasedEdge(),
    placed: seconds => Message.PlacedPlayhead({ seconds }),
    selected: lineId => Message.SelectedLine({ lineId }),
    listening: () => Message.CompletedFollowPointer(),
  },
)

export const readOut = (model: Model): string => {
  const clip = levelClipOf(model.clip)
  const line = clip.lines[selectedIndexOf(clip, model.editor)]
  const draft = Option.match(model.editor.maybeDraft, {
    onNone: () => '',
    onSome: found => `, an edge moving to ${preciseClockText(found.seconds)}`,
  })
  return `${clip.lines.length} lines; line ${line?.number ?? 0} selected, ${preciseClockText(line?.from ?? 0)} to ${preciseClockText(line?.to ?? 0)}; playhead ${preciseClockText(model.editor.playhead)}${draft}. ${Option.getOrElse(model.maybeAsked, () => 'Nothing changed yet.')}`
}

export const choices: ReadonlyArray<string> = [
  'The waveform shows the selected line with a second and a half either side, at least four seconds. Is that enough context to place an edge, or would a whole-clip overview strip help?',
  'An edge moved by the keys is kept half a second after the last key, and each change waits for the moved lines to be tracked again before the next; is that quick enough with a keyboard?',
  'An edge two lines share, as a split leaves it, moves both lines. Should it be possible to pull them apart there instead?',
  'Undo is once, for the last change only, and survives a reload. Is a single undo enough?',
  'Deleting a line keeps its takes in the history, under the line’s old name. Should deleting offer to take them too?',
  'Low pitch confidence is marked under 40% of the speech with a pitch, and likely music over half the pauses with one (docs/cut-study.md). Are the words for what each means for the match plain enough?',
]

const clipButton = (
  music: boolean,
  text: string,
  h: HtmlBuilder<Message>,
): Html =>
  h.button(
    [
      h.Type('button'),
      h.OnClick(Message.ClickedClip({ music })),
      h.Class(
        `inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-3 text-sm ${buttonFocusClass}`,
      ),
    ],
    [text],
  )

export const view = (model: Model, h: HtmlBuilder<Message>): Html =>
  entryFrame(
    {
      title: 'Line editor',
      summary:
        'Fixing a clip’s lines on its level: the waveform around the selected line, its edges to drag or step by key, the playhead to split at, merge, delete and the one undo, and the marks of a weak line.',
      demo: [
        h.div(
          [h.Class('flex flex-wrap gap-2')],
          [
            clipButton(false, 'The cut study’s clip', h),
            clipButton(true, 'The same clip over music', h),
          ],
        ),
        lineEditorView(
          levelClipOf(model.clip),
          model.editor,
          {
            stepEdge: (lineId, edge, step) =>
              Message.SteppedEdge({ lineId, edge, step }),
            stepPlayhead: step => Message.SteppedPlayhead({ step }),
            select: lineId => Message.SelectedLine({ lineId }),
            play: Message.ClickedPlay(),
            stop: Message.ClickedStop(),
            split: Message.ClickedSplit(),
            merge: (lineId, select) => Message.ClickedMerge({ lineId, select }),
            remove: Message.ClickedDelete(),
            undo: Message.ClickedUndo(),
            follow: FollowPointer(),
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
