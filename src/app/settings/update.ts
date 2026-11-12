import { Option } from 'effect'
import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { Dialog } from '@foldkit/ui'

import { HistoryPage, LineHistoryPage } from '../history/history'
import { ClipsPage, LevelPage } from '../level/level'
import { NativeCurve } from '../line/native'
import { Message } from '../message'
import type { Model } from '../model'
import type { AppResourceServices } from '../resources'
import { Take } from '../take/take'
import {
  ClearAllData,
  LoadSettings,
  RestoreBackup,
  SaveBackup,
  SetKeepTakeAudio,
} from './commands'
import {
  BackupState,
  ClearState,
  RestoreState,
  type SettingsFacts,
  SettingsPage,
  type StorageFacts,
} from './settings'

// The settings screen's transitions. It reads the device when it opens;
// each action says how it went where it was started.

type SettingsUpdate = Update.Return<Model, Message, AppResourceServices>
type ReadySettings = Extract<SettingsPage, { _tag: 'Ready' }>

const unchanged = (model: Model): SettingsUpdate => ({ model })

export const clearedNotice =
  'Everything Intone kept on this device is deleted: your takes, their audio, your clips, your settings and the lines’ curves.'

export const openedSettings = (model: Model): SettingsUpdate => ({
  model: modifyFields(model, {
    settings: () => SettingsPage.Loading(),
    maybeSettingsNotice: () => Option.none(),
  }),
  commands: [LoadSettings()],
})

// The facts read again keep what the screen was showing about its last
// backup, restore and clearing.
export const succeededLoadSettings = (
  model: Model,
  facts: SettingsFacts,
): SettingsUpdate => {
  const page = model.settings
  if (page._tag !== 'Loading' && page._tag !== 'Ready') {
    return unchanged(model)
  }
  return {
    model: modifyFields(model, {
      settings: () =>
        page._tag === 'Ready'
          ? modifyFields(page, {
              keepTakeAudio: () => facts.keepTakeAudio,
              takes: () => facts.takes,
              takesWithAudio: () => facts.takesWithAudio,
              clipsWithAudio: () => facts.clipsWithAudio,
              storage: () => facts.storage,
            })
          : SettingsPage.Ready({
              keepTakeAudio: facts.keepTakeAudio,
              takes: facts.takes,
              takesWithAudio: facts.takesWithAudio,
              clipsWithAudio: facts.clipsWithAudio,
              storage: facts.storage,
              maybeKeepAudioFailure: Option.none(),
              includeAudio: false,
              backup: BackupState.Idle(),
              restore: RestoreState.Idle(),
              clearing: ClearState.Idle(),
            }),
    }),
  }
}

export const failedLoadSettings = (
  model: Model,
  reason: string,
): SettingsUpdate =>
  model.settings._tag === 'Loading'
    ? {
        model: modifyFields(model, {
          settings: () => SettingsPage.Failed({ reason }),
        }),
      }
    : unchanged(model)

const whenReady = (
  model: Model,
  change: (page: ReadySettings) => ReadySettings,
  ...commands: Update.Commands<Message, AppResourceServices>
): SettingsUpdate => {
  const page = model.settings
  return page._tag === 'Ready'
    ? {
        model: modifyFields(model, { settings: () => change(page) }),
        commands,
      }
    : unchanged(model)
}

export const toggledKeepTakeAudio = (
  model: Model,
  keep: boolean,
): SettingsUpdate =>
  whenReady(
    model,
    page =>
      modifyFields(page, {
        keepTakeAudio: () => keep,
        maybeKeepAudioFailure: () => Option.none(),
      }),
    SetKeepTakeAudio({ keep }),
  )

export const failedSetKeepTakeAudio = (
  model: Model,
  reason: string,
): SettingsUpdate =>
  whenReady(model, page =>
    modifyFields(page, {
      keepTakeAudio: keep => !keep,
      maybeKeepAudioFailure: () => Option.some(reason),
    }),
  )

export const completedAskToPersistStorage = (
  model: Model,
  storage: StorageFacts,
): SettingsUpdate =>
  whenReady(model, page => modifyFields(page, { storage: () => storage }))

export const toggledBackupAudio = (
  model: Model,
  include: boolean,
): SettingsUpdate =>
  whenReady(model, page => modifyFields(page, { includeAudio: () => include }))

export const clickedSaveBackup = (model: Model): SettingsUpdate =>
  model.settings._tag === 'Ready' && model.settings.backup._tag !== 'Saving'
    ? whenReady(
        model,
        page => modifyFields(page, { backup: () => BackupState.Saving() }),
        SaveBackup({ includeAudio: model.settings.includeAudio }),
      )
    : unchanged(model)

export const succeededSaveBackup = (
  model: Model,
  fileName: string,
  takes: number,
): SettingsUpdate =>
  whenReady(model, page =>
    modifyFields(page, {
      backup: () => BackupState.Saved({ fileName, takes }),
    }),
  )

export const failedSaveBackup = (
  model: Model,
  reason: string,
): SettingsUpdate =>
  whenReady(model, page =>
    modifyFields(page, { backup: () => BackupState.Failed({ reason }) }),
  )

export const clickedRestoreBackup = (model: Model): SettingsUpdate =>
  model.settings._tag === 'Ready' && model.settings.restore._tag !== 'Restoring'
    ? whenReady(
        model,
        page => modifyFields(page, { restore: () => RestoreState.Restoring() }),
        RestoreBackup(),
      )
    : unchanged(model)

// A restored backup changes what the history screens show, so they read
// the device again when next opened.
export const succeededRestoreBackup = (
  model: Model,
  takes: number,
): SettingsUpdate => {
  const restored = whenReady(
    model,
    page =>
      modifyFields(page, { restore: () => RestoreState.Restored({ takes }) }),
    LoadSettings(),
  )
  return {
    ...restored,
    model: modifyFields(restored.model, {
      history: () => HistoryPage.NotLoaded(),
      lineHistory: () => LineHistoryPage.NotLoaded(),
    }),
  }
}

export const completedRestoreBackup = (model: Model): SettingsUpdate =>
  whenReady(model, page =>
    modifyFields(page, { restore: () => RestoreState.Idle() }),
  )

export const failedRestoreBackup = (
  model: Model,
  reason: string,
): SettingsUpdate =>
  whenReady(model, page =>
    modifyFields(page, { restore: () => RestoreState.Failed({ reason }) }),
  )

// CLEARING EVERYTHING

const foldClearDialogOutMessage = Dialog.OutMessage.match<
  Update.Step<Model, Message>
>({
  Opened: () => model => ({ model }),
  Closed: () => model => ({
    model: modifyFields(model, {
      settings: page =>
        page._tag === 'Ready' && page.clearing._tag === 'Failed'
          ? modifyFields(page, { clearing: () => ClearState.Idle() })
          : page,
    }),
  }),
})

const dialogFields = {
  read: (model: Model) => Option.some(model.clearDialog),
  write: (model: Model, nextClearDialog: Dialog.Model) =>
    modifyFields(model, { clearDialog: () => nextClearDialog }),
  toParentMessage: (message: Dialog.Message) =>
    Message.GotClearDialogMessage({ message }),
  foldOutMessage: foldClearDialogOutMessage,
}

export const foldClearDialog = Update.foldChild({
  update: Dialog.update,
  ...dialogFields,
})

const foldClearDialogOpen = Update.foldChildStep({
  update: Dialog.open,
  ...dialogFields,
})

const foldClearDialogClose = Update.foldChildStep({
  update: Dialog.close,
  ...dialogFields,
})

export const clickedClearAll = (model: Model): SettingsUpdate =>
  model.settings._tag === 'Ready'
    ? foldClearDialogOpen(model)
    : unchanged(model)

export const clickedKeepEverything = (model: Model): SettingsUpdate =>
  foldClearDialogClose(model)

export const submittedClearAll = (model: Model): SettingsUpdate =>
  model.settings._tag === 'Ready' && model.settings.clearing._tag !== 'Clearing'
    ? whenReady(
        model,
        page => modifyFields(page, { clearing: () => ClearState.Clearing() }),
        ClearAllData(),
      )
    : unchanged(model)

// Once everything is deleted the screens forget what they showed of it,
// and the settings are read again.
export const succeededClearAllData = (model: Model): SettingsUpdate =>
  Update.combine(model, [
    stepModel => ({
      model: modifyFields(stepModel, {
        settings: () => SettingsPage.Loading(),
        maybeSettingsNotice: () => Option.some(clearedNotice),
        history: () => HistoryPage.NotLoaded(),
        lineHistory: () => LineHistoryPage.NotLoaded(),
        native: () => NativeCurve.NoLine(),
        take: () => Take.Idle(),
        clips: () => ClipsPage.NotLoaded(),
        level: () => LevelPage.NotLoaded(),
      }),
      commands: [LoadSettings()],
    }),
    foldClearDialogClose,
  ])

export const failedClearAllData = (
  model: Model,
  reason: string,
): SettingsUpdate =>
  whenReady(model, page =>
    modifyFields(page, { clearing: () => ClearState.Failed({ reason }) }),
  )
