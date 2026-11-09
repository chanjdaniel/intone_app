import { Option } from 'effect'
import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { Dialog } from '@foldkit/ui'

import { HistoryPage, LineHistoryPage } from '../history/history'
import { NativeCurve } from '../line/native'
import { Message } from '../message'
import type { Model } from '../model'
import type { TakeResourceServices } from '../take/resources'
import {
  DeleteClip,
  FocusLevelRow,
  GoHome,
  LoadClips,
  LoadLevel,
  ReplaceLevelFind,
} from './commands'
import {
  type ClipSummary,
  ClipsPage,
  DeleteState,
  type LevelClip,
  LevelPage,
  levelRowsPerPage,
} from './level'

// The clips' transitions: the home screen's list and a clip's level are
// read from the device when their screen opens, and a result for a
// screen no longer open, or for another clip, changes nothing.

type LevelUpdate = Update.Return<Model, Message, TakeResourceServices>
type ReadyLevel = Extract<LevelPage, { _tag: 'Ready' }>

const unchanged = (model: Model): LevelUpdate => ({ model })

// The home screen reads the clips each time it opens, still showing what
// it had while it reads.
export const openedHome = (model: Model): LevelUpdate => ({
  model: modifyFields(model, {
    clips: clips => (clips._tag === 'Ready' ? clips : ClipsPage.Loading()),
  }),
  commands: [LoadClips()],
})

export const succeededLoadClips = (
  model: Model,
  clips: ReadonlyArray<ClipSummary>,
): LevelUpdate => ({
  model: modifyFields(model, { clips: () => ClipsPage.Ready({ clips }) }),
})

export const failedLoadClips = (model: Model, reason: string): LevelUpdate => ({
  model: modifyFields(model, { clips: () => ClipsPage.Failed({ reason }) }),
})

const isLevelOf = (page: LevelPage, clipId: string): boolean =>
  (page._tag === 'Ready' && page.clip.id === clipId) ||
  (page._tag !== 'Ready' && page._tag !== 'NotLoaded' && page.clipId === clipId)

export const openedLevel = (model: Model, clipId: string): LevelUpdate =>
  model.level._tag === 'Ready' && model.level.clip.id === clipId
    ? unchanged(model)
    : {
        model: modifyFields(model, {
          level: () => LevelPage.Loading({ clipId }),
        }),
        commands: [LoadLevel({ clipId })],
      }

export const succeededLoadLevel = (
  model: Model,
  clipId: string,
  maybeClip: Option.Option<LevelClip>,
): LevelUpdate =>
  model.level._tag === 'Loading' && isLevelOf(model.level, clipId)
    ? {
        model: modifyFields(model, {
          level: () =>
            Option.match(maybeClip, {
              onNone: () => LevelPage.Missing({ clipId }),
              onSome: clip =>
                LevelPage.Ready({
                  clip,
                  shownRows: levelRowsPerPage,
                  deleting: DeleteState.Idle(),
                }),
            }),
        }),
      }
    : unchanged(model)

export const failedLoadLevel = (
  model: Model,
  clipId: string,
  reason: string,
): LevelUpdate =>
  model.level._tag === 'Loading' && isLevelOf(model.level, clipId)
    ? {
        model: modifyFields(model, {
          level: () => LevelPage.Failed({ clipId, reason }),
        }),
      }
    : unchanged(model)

const whenReady = (
  model: Model,
  change: (page: ReadyLevel) => ReadyLevel,
  ...commands: Update.Commands<Message, TakeResourceServices>
): LevelUpdate =>
  model.level._tag === 'Ready'
    ? {
        model: modifyFields(model, {
          level: page => (page._tag === 'Ready' ? change(page) : page),
        }),
        commands,
      }
    : unchanged(model)

export const changedFindLevelLines = (
  model: Model,
  words: string,
): LevelUpdate =>
  model.level._tag === 'Ready'
    ? {
        model,
        commands: [ReplaceLevelFind({ clipId: model.level.clip.id, words })],
      }
    : unchanged(model)

// New words in the address show one page of the rows they find again.
export const changedLevelFind = (model: Model): LevelUpdate =>
  whenReady(model, page =>
    modifyFields(page, { shownRows: () => levelRowsPerPage }),
  )

export const clickedShowMoreLevelLines = (model: Model): LevelUpdate =>
  model.level._tag === 'Ready'
    ? whenReady(
        model,
        page =>
          modifyFields(page, { shownRows: rows => rows + levelRowsPerPage }),
        FocusLevelRow({ index: model.level.shownRows }),
      )
    : unchanged(model)

// DELETING THE CLIP

const foldDeleteDialogOutMessage = Dialog.OutMessage.match<
  Update.Step<Model, Message>
>({
  Opened: () => model => ({ model }),
  Closed: () => model => ({
    model: modifyFields(model, {
      level: page =>
        page._tag === 'Ready' && page.deleting._tag === 'Failed'
          ? modifyFields(page, { deleting: () => DeleteState.Idle() })
          : page,
    }),
  }),
})

const dialogFields = {
  read: (model: Model) => Option.some(model.deleteClipDialog),
  write: (model: Model, nextDeleteClipDialog: Dialog.Model) =>
    modifyFields(model, { deleteClipDialog: () => nextDeleteClipDialog }),
  toParentMessage: (message: Dialog.Message) =>
    Message.GotDeleteClipDialogMessage({ message }),
  foldOutMessage: foldDeleteDialogOutMessage,
}

export const foldDeleteClipDialog = Update.foldChild({
  update: Dialog.update,
  ...dialogFields,
})

const foldDeleteClipDialogOpen = Update.foldChildStep({
  update: Dialog.open,
  ...dialogFields,
})

const foldDeleteClipDialogClose = Update.foldChildStep({
  update: Dialog.close,
  ...dialogFields,
})

export const clickedDeleteClip = (model: Model): LevelUpdate =>
  model.level._tag === 'Ready'
    ? foldDeleteClipDialogOpen(model)
    : unchanged(model)

export const clickedKeepClip = (model: Model): LevelUpdate =>
  foldDeleteClipDialogClose(model)

export const submittedDeleteClip = (model: Model): LevelUpdate =>
  model.level._tag === 'Ready' && model.level.deleting._tag !== 'Deleting'
    ? whenReady(
        model,
        page => modifyFields(page, { deleting: () => DeleteState.Deleting() }),
        DeleteClip({
          clipId: model.level.clip.id,
          name: model.level.clip.name,
        }),
      )
    : unchanged(model)

// Once the clip is deleted the screens forget what they showed of it,
// and the home screen says so.
export const succeededDeleteClip = (
  model: Model,
  clipId: string,
  name: string,
): LevelUpdate =>
  Update.combine(model, [
    stepModel => ({
      model: modifyFields(stepModel, {
        level: () => LevelPage.NotLoaded(),
        clips: clips =>
          clips._tag === 'Ready'
            ? ClipsPage.Ready({
                clips: clips.clips.filter(clip => clip.id !== clipId),
              })
            : clips,
        maybeHomeNotice: () =>
          Option.some(
            `Deleted ${name}, with its lines and your takes of them.`,
          ),
        history: () => HistoryPage.NotLoaded(),
        lineHistory: () => LineHistoryPage.NotLoaded(),
        native: native =>
          native._tag !== 'NoLine' && native.clipId === clipId
            ? NativeCurve.NoLine()
            : native,
      }),
      commands: [GoHome()],
    }),
    foldDeleteClipDialogClose,
  ])

export const failedDeleteClip = (
  model: Model,
  clipId: string,
  reason: string,
): LevelUpdate =>
  model.level._tag === 'Ready' && model.level.clip.id === clipId
    ? whenReady(model, page =>
        modifyFields(page, { deleting: () => DeleteState.Failed({ reason }) }),
      )
    : unchanged(model)
