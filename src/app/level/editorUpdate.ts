import { Option } from 'effect'
import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { type Edge, onSampleGrid } from '../../engine/cut/edit'
import { HistoryPage, LineHistoryPage } from '../history/history'
import { preciseClockText } from '../line/lines'
import { NativeCurve } from '../line/native'
import type { Message } from '../message'
import type { Model } from '../model'
import type { AppResourceServices } from '../resources'
import {
  ClipWaveform,
  EditSaving,
  LevelPlay,
  type LineEditor,
  canChange,
  canSplitAtPlayhead,
  clampedEdge,
  edgeSecondsOf,
  lineNumberOf,
  selectedIndexOf,
  selectedLineOf,
} from './editor'
import {
  EditClipLines,
  FocusLineEditor,
  UndoClipLineChange,
  WaitForKeysToRest,
} from './editorCommands'
import type { LevelClip } from './level'

// The line editor's transitions (./editor.ts). Playing and changing are
// apart: a play changes no line, and a change, once kept, stops a play,
// since the lines it played may have moved. A change is asked for only
// while the clip Worker holds the clip and no other change is being
// kept, so they never cross.

type EditorUpdate = Update.Return<Model, Message, AppResourceServices>

const unchanged = (model: Model): EditorUpdate => ({ model })

// The open level's editor, changed by `change`, with what it asks for.
const withEditor = (
  model: Model,
  change: (
    editor: LineEditor,
    clip: LevelClip,
  ) => Readonly<{
    editor: LineEditor
    commands?: Update.Commands<Message, AppResourceServices>
  }>,
): EditorUpdate => {
  if (model.level._tag !== 'Ready') {
    return unchanged(model)
  }
  const changed = change(model.level.editor, model.level.clip)
  return {
    model: modifyFields(model, {
      level: page =>
        page._tag === 'Ready'
          ? modifyFields(page, { editor: () => changed.editor })
          : page,
    }),
    ...(changed.commands === undefined ? {} : { commands: changed.commands }),
  }
}

const startPlay = (editor: LineEditor, from: number, to: number): LineEditor =>
  modifyFields(editor, {
    play: () =>
      LevelPlay.Playing({ playNumber: editor.playsStarted + 1, from, to }),
    playsStarted: started => started + 1,
    playhead: () => from,
  })

// THE CLIP WORKER

export const acquiredClipEditor = (
  model: Model,
  clipId: string,
  peaks: Uint8Array,
): EditorUpdate =>
  model.level._tag === 'Ready' && model.level.clip.id === clipId
    ? withEditor(model, editor => ({
        editor: modifyFields(editor, {
          waveform: () => ClipWaveform.Ready({ peaks }),
        }),
      }))
    : unchanged(model)

export const failedAcquireClipEditor = (
  model: Model,
  reason: string,
): EditorUpdate =>
  withEditor(model, editor => ({
    editor: modifyFields(editor, {
      waveform: () => ClipWaveform.Failed({ reason }),
    }),
  }))

// Left, the level's waveform goes with its Worker, to be read again when
// it opens.
export const releasedClipEditor = (model: Model): EditorUpdate =>
  withEditor(model, editor => ({
    editor: modifyFields(editor, {
      waveform: () => ClipWaveform.Opening(),
      play: () => LevelPlay.Stopped(),
      maybeDraft: () => Option.none(),
    }),
  }))

// SELECTING AND PLAYING

// Selecting a line plays it from its start; from the list, the focus
// moves to the editor too.
export const selectedLevelLine = (
  model: Model,
  lineId: string,
  fromList: boolean,
): EditorUpdate =>
  withEditor(model, (editor, clip) => {
    const maybeLine = clip.lines.find(line => line.id === lineId)
    if (
      maybeLine === undefined ||
      editor.saving._tag === 'Saving' ||
      Option.isSome(editor.maybeDraft)
    ) {
      return { editor }
    }
    return {
      editor: startPlay(
        modifyFields(editor, {
          selectedId: () => lineId,
          maybeNotice: () => Option.none(),
        }),
        maybeLine.from,
        maybeLine.to,
      ),
      ...(fromList ? { commands: [FocusLineEditor()] } : {}),
    }
  })

// Plays the selected line from the playhead when it is inside it, else
// from its start.
export const clickedPlayLevelLine = (model: Model): EditorUpdate =>
  withEditor(model, (editor, clip) =>
    Option.match(selectedLineOf(clip, editor), {
      onNone: () => ({ editor }),
      onSome: line => ({
        editor: startPlay(
          editor,
          editor.playhead >= line.from && editor.playhead < line.to - 0.05
            ? editor.playhead
            : line.from,
          line.to,
        ),
      }),
    }),
  )

export const clickedStopLevelLine = (model: Model): EditorUpdate =>
  withEditor(model, editor => ({
    editor: modifyFields(editor, { play: () => LevelPlay.Stopped() }),
  }))

const isPlay = (editor: LineEditor, playNumber: number): boolean =>
  editor.play._tag === 'Playing' && editor.play.playNumber === playNumber

export const movedLevelPlayhead = (
  model: Model,
  playNumber: number,
  seconds: number,
): EditorUpdate =>
  withEditor(model, editor => ({
    editor: isPlay(editor, playNumber)
      ? modifyFields(editor, { playhead: () => seconds })
      : editor,
  }))

export const endedLevelPlayback = (
  model: Model,
  playNumber: number,
): EditorUpdate =>
  withEditor(model, editor => ({
    editor: isPlay(editor, playNumber)
      ? modifyFields(editor, { play: () => LevelPlay.Stopped() })
      : editor,
  }))

export const failedLevelPlayback = (
  model: Model,
  playNumber: number,
  reason: string,
): EditorUpdate =>
  withEditor(model, editor => ({
    editor: isPlay(editor, playNumber)
      ? modifyFields(editor, {
          play: () => LevelPlay.Stopped(),
          maybeNotice: () => Option.some(`The line did not play. ${reason}`),
        })
      : editor,
  }))

// A key's step of the playhead, from where it is now.
export const steppedLevelPlayhead = (
  model: Model,
  step: number,
): EditorUpdate =>
  model.level._tag === 'Ready'
    ? placedLevelPlayhead(model, model.level.editor.playhead + step)
    : unchanged(model)

export const placedLevelPlayhead = (
  model: Model,
  seconds: number,
): EditorUpdate =>
  withEditor(model, (editor, clip) => ({
    editor: modifyFields(editor, {
      playhead: () =>
        Math.min(clip.seconds, Math.max(0, onSampleGrid(seconds))),
      play: () => LevelPlay.Stopped(),
    }),
  }))

// CHANGING THE LINES

const saving = (
  editor: LineEditor,
  index: number,
  notice: string,
  maybeSelect: Option.Option<string> = Option.none(),
): LineEditor =>
  modifyFields(editor, {
    saving: () => EditSaving.Saving({ maybeSelect, index, notice }),
    maybeNotice: () => Option.none(),
  })

const edgeWords = (edge: Edge): string => (edge === 'from' ? 'start' : 'end')

// An edge moved by the pointer or a key: a draft, kept when the pointer
// lets go or the keys rest.
export const movedLineEdge = (
  model: Model,
  lineId: string,
  edge: Edge,
  seconds: number,
  by: 'Pointer' | 'Keyboard',
): EditorUpdate =>
  withEditor(model, (editor, clip) => {
    const isDraftOf = Option.match(editor.maybeDraft, {
      onNone: () => true,
      onSome: draft => draft.lineId === lineId && draft.edge === edge,
    })
    if (
      editor.waveform._tag !== 'Ready' ||
      editor.saving._tag === 'Saving' ||
      !isDraftOf ||
      clip.lines.every(line => line.id !== lineId)
    ) {
      return { editor }
    }
    const draftNumber = editor.draftsMade + 1
    return {
      editor: modifyFields(editor, {
        maybeDraft: () =>
          Option.some({
            lineId,
            edge,
            seconds: clampedEdge(clip, lineId, edge, seconds),
            draftNumber,
            by,
          }),
        draftsMade: () => draftNumber,
        maybeNotice: () => Option.none(),
      }),
      ...(by === 'Keyboard'
        ? { commands: [WaitForKeysToRest({ draftNumber })] }
        : {}),
    }
  })

// A key's step of an edge, from where it is now: its draft, or where it
// is kept.
export const steppedLineEdge = (
  model: Model,
  lineId: string,
  edge: Edge,
  step: number,
): EditorUpdate => {
  if (model.level._tag !== 'Ready') {
    return unchanged(model)
  }
  const { clip, editor } = model.level
  const line = clip.lines.find(found => found.id === lineId)
  return line === undefined
    ? unchanged(model)
    : movedLineEdge(
        model,
        lineId,
        edge,
        edgeSecondsOf(clip, editor, line, edge) + step,
        'Keyboard',
      )
}

// Keeps the draft: nothing when it is back where the edge was.
const keepDraft = (
  editor: LineEditor,
  clip: LevelClip,
): Readonly<{
  editor: LineEditor
  commands?: Update.Commands<Message, AppResourceServices>
}> =>
  Option.match(editor.maybeDraft, {
    onNone: () => ({ editor }),
    onSome: draft => {
      const index = clip.lines.findIndex(line => line.id === draft.lineId)
      const line = clip.lines[index]
      if (line === undefined || line[draft.edge] === draft.seconds) {
        return {
          editor: modifyFields(editor, { maybeDraft: () => Option.none() }),
        }
      }
      return {
        editor: saving(
          editor,
          index,
          `Line ${line.number}’s ${edgeWords(draft.edge)} moved to ${preciseClockText(draft.seconds)}.`,
        ),
        commands: [
          EditClipLines({
            clipId: clip.id,
            edit: {
              _tag: 'Move',
              lineId: draft.lineId,
              edge: draft.edge,
              seconds: draft.seconds,
            },
          }),
        ],
      }
    },
  })

export const releasedLineEdge = (model: Model): EditorUpdate =>
  withEditor(model, (editor, clip) =>
    Option.match(editor.maybeDraft, {
      onSome: draft =>
        draft.by === 'Pointer' ? keepDraft(editor, clip) : { editor },
      onNone: () => ({ editor }),
    }),
  )

export const completedWaitForKeysToRest = (
  model: Model,
  draftNumber: number,
): EditorUpdate =>
  withEditor(model, (editor, clip) =>
    Option.match(editor.maybeDraft, {
      onSome: draft =>
        draft.by === 'Keyboard' && draft.draftNumber === draftNumber
          ? keepDraft(editor, clip)
          : { editor },
      onNone: () => ({ editor }),
    }),
  )

export const clickedSplitLine = (model: Model): EditorUpdate =>
  withEditor(model, (editor, clip) => {
    const index = selectedIndexOf(clip, editor)
    const line = clip.lines[index]
    if (
      line === undefined ||
      !canChange(editor) ||
      !canSplitAtPlayhead(clip, editor)
    ) {
      return { editor }
    }
    return {
      editor: saving(
        modifyFields(editor, { play: () => LevelPlay.Stopped() }),
        index,
        `Line ${line.number} is split at ${preciseClockText(editor.playhead)}, into lines ${line.number} and ${line.number + 1}.`,
        Option.some(line.id),
      ),
      commands: [
        EditClipLines({
          clipId: clip.id,
          edit: { _tag: 'Split', lineId: line.id, seconds: editor.playhead },
        }),
      ],
    }
  })

// Line `lineId` merged with the line after it; `select` is the line
// selected when it was asked for, so its merge with the line before keeps
// the merged line selected.
export const clickedMergeLines = (model: Model, lineId: string): EditorUpdate =>
  withEditor(model, (editor, clip) => {
    const index = clip.lines.findIndex(line => line.id === lineId)
    const line = clip.lines[index]
    const after = clip.lines[index + 1]
    if (line === undefined || after === undefined || !canChange(editor)) {
      return { editor }
    }
    return {
      editor: saving(
        modifyFields(editor, { play: () => LevelPlay.Stopped() }),
        index,
        `Lines ${line.number} and ${after.number} are one line now, line ${line.number}.`,
        Option.some(line.id),
      ),
      commands: [
        EditClipLines({ clipId: clip.id, edit: { _tag: 'Merge', lineId } }),
      ],
    }
  })

export const clickedDeleteLine = (model: Model): EditorUpdate =>
  withEditor(model, (editor, clip) => {
    const index = selectedIndexOf(clip, editor)
    const line = clip.lines[index]
    if (line === undefined || clip.lines.length < 2 || !canChange(editor)) {
      return { editor }
    }
    const next = clip.lines[index + 1] ?? clip.lines[index - 1]
    return {
      editor: saving(
        modifyFields(editor, { play: () => LevelPlay.Stopped() }),
        index,
        `Line ${line.number} is deleted. Your takes of it are kept in your history.`,
        Option.fromNullishOr(next?.id),
      ),
      commands: [
        EditClipLines({
          clipId: clip.id,
          edit: { _tag: 'Delete', lineId: line.id },
        }),
      ],
    }
  })

export const clickedUndoLineChange = (model: Model): EditorUpdate =>
  withEditor(model, (editor, clip) =>
    Option.isNone(clip.maybeUndo) ||
    editor.saving._tag === 'Saving' ||
    Option.isSome(editor.maybeDraft)
      ? { editor }
      : {
          editor: saving(
            modifyFields(editor, { play: () => LevelPlay.Stopped() }),
            selectedIndexOf(clip, editor),
            'The last change is undone.',
            Option.some(editor.selectedId),
          ),
          commands: [UndoClipLineChange({ clipId: clip.id })],
        },
  )

// Once kept, the screens that showed the clip's lines or their curves
// read them again when they next open.
export const succeededEditClipLines = (
  model: Model,
  clipId: string,
  clip: LevelClip,
): EditorUpdate => {
  if (
    model.level._tag !== 'Ready' ||
    model.level.clip.id !== clipId ||
    model.level.editor.saving._tag !== 'Saving'
  ) {
    return unchanged(model)
  }
  const { maybeSelect, index, notice } = model.level.editor.saving
  const fallback =
    clip.lines[Math.min(index, clip.lines.length - 1)] ?? clip.lines[0]
  const selected = Option.getOrElse(
    Option.filter(maybeSelect, id => Option.isSome(lineNumberOf(clip, id))),
    () => fallback?.id ?? '',
  )
  const selectedLine = clip.lines.find(line => line.id === selected)
  return {
    model: modifyFields(model, {
      level: page =>
        page._tag === 'Ready'
          ? modifyFields(page, {
              clip: () => clip,
              editor: editor =>
                modifyFields(editor, {
                  selectedId: () => selected,
                  playhead: playhead =>
                    selectedLine === undefined ||
                    (playhead >= selectedLine.from &&
                      playhead <= selectedLine.to)
                      ? playhead
                      : selectedLine.from,
                  play: () => LevelPlay.Stopped(),
                  maybeDraft: () => Option.none(),
                  saving: () => EditSaving.Idle(),
                  maybeNotice: () => Option.some(notice),
                }),
            })
          : page,
      native: native =>
        native._tag !== 'NoLine' && native.clipId === clipId
          ? NativeCurve.NoLine()
          : native,
      lineHistory: () => LineHistoryPage.NotLoaded(),
      history: () => HistoryPage.NotLoaded(),
    }),
  }
}

export const failedEditClipLines = (
  model: Model,
  clipId: string,
  reason: string,
): EditorUpdate =>
  model.level._tag === 'Ready' && model.level.clip.id === clipId
    ? withEditor(model, editor => ({
        editor: modifyFields(editor, {
          maybeDraft: () => Option.none(),
          saving: () => EditSaving.Failed({ reason }),
        }),
      }))
    : unchanged(model)
