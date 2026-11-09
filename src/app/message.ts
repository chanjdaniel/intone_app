import { Schema } from 'effect'
import { Calendar } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { UrlRequest } from 'foldkit/navigation'
import { Url } from 'foldkit/url'

import { Dialog } from '@foldkit/ui'

import { MicrophoneFailure } from '../services/microphone'
import { DayCount, LineSummary, ShownTake, TrendPoint } from './history/history'
import { ListenSpeed } from './line/native'
import { SettingsFacts, StorageFacts } from './settings/settings'
import { Extent, TakeCurve, TakeFeatures, TakeResult, Voice } from './take/take'

const takeNumber = Schema.Finite

export const Message = defineMessageUnion({
  ClickedLink: { request: UrlRequest },
  ChangedUrl: { url: Url },
  CompletedNavigateInternal: {},
  CompletedLoadExternal: {},
  CompletedMountDevLibrary: {},
  FailedMountDevLibrary: { reason: Schema.String },

  // The line.
  SucceededLoadNativeCurve: {
    clipId: Schema.String,
    lineId: Schema.String,
    curve: TakeCurve,
    features: TakeFeatures,
  },
  FailedLoadNativeCurve: {
    clipId: Schema.String,
    lineId: Schema.String,
    reason: Schema.String,
  },
  ClickedRetryNativeCurve: {},
  ClickedListen: { voice: Voice, extent: Extent },
  ClickedStopListening: {},
  EndedListening: { voice: Voice, extent: Extent },
  SelectedListenSpeed: { speed: ListenSpeed },
  FailedPlayback: { reason: Schema.String },
  CompletedForgetTakeAudio: {},

  // The take.
  ClickedRecord: {},
  EndedNativeBeforeTake: { takeNumber },
  ClickedStop: {},
  ClickedCancelTake: {},
  AcquiredTracker: {},
  FailedAcquireTracker: { reason: Schema.String },
  ReleasedTracker: {},
  AcquiredMicrophone: {},
  FailedAcquireMicrophone: {
    failure: MicrophoneFailure,
    reason: Schema.String,
  },
  ReleasedMicrophone: {},
  CompletedWaitForMicAnswer: { takeNumber },
  TickedTakeMeter: {
    takeNumber,
    elapsedSeconds: Schema.Finite,
    levelDb: Schema.Finite,
  },
  DetectedVoiceOnset: { takeNumber, onsetSeconds: Schema.Finite },
  FailedRecordTake: { takeNumber, reason: Schema.String },
  SucceededAnalyseTake: { takeNumber, result: TakeResult },
  FailedAnalyseTake: { takeNumber, reason: Schema.String },
  CompletedFocusTakeControl: {},
  CompletedDrawCurvePair: {},
  CompletedAskToPersistStorage: { storage: StorageFacts },

  // The history.
  SucceededLoadHistory: {
    lines: Schema.Array(LineSummary),
    days: Schema.Array(DayCount),
    today: Calendar.CalendarDate,
    outdatedIds: Schema.Array(Schema.String),
    unreadable: Schema.Finite,
  },
  FailedLoadHistory: { reason: Schema.String },
  ChangedFindLines: { words: Schema.String },
  CompletedReplaceFind: {},
  ClickedShowMoreLines: {},
  CompletedFocusLineRow: {},
  ClickedPreviousMonth: {},
  ClickedNextMonth: {},
  ClickedRescore: {},
  SucceededRescoreTakes: { rescored: Schema.Finite },
  FailedRescoreTakes: { reason: Schema.String },
  SucceededLoadLineHistory: {
    clipId: Schema.String,
    lineId: Schema.String,
    maybeFound: Schema.Option(
      Schema.Struct({
        lineText: Schema.String,
        trend: Schema.Array(TrendPoint),
        first: ShownTake,
        maybeBest: Schema.Option(ShownTake),
        latest: ShownTake,
      }),
    ),
  },
  FailedLoadLineHistory: {
    clipId: Schema.String,
    lineId: Schema.String,
    reason: Schema.String,
  },

  // The settings.
  SucceededLoadSettings: { facts: SettingsFacts },
  FailedLoadSettings: { reason: Schema.String },
  ToggledKeepTakeAudio: { keep: Schema.Boolean },
  SucceededSetKeepTakeAudio: { keep: Schema.Boolean },
  FailedSetKeepTakeAudio: { reason: Schema.String },
  ClickedAskToPersistStorage: {},
  ToggledBackupAudio: { include: Schema.Boolean },
  ClickedSaveBackup: {},
  SucceededSaveBackup: { fileName: Schema.String, takes: Schema.Finite },
  FailedSaveBackup: { reason: Schema.String },
  ClickedRestoreBackup: {},
  SucceededRestoreBackup: { takes: Schema.Finite },
  CancelledRestoreBackup: {},
  FailedRestoreBackup: { reason: Schema.String },
  ClickedClearAll: {},
  GotClearDialogMessage: { message: Dialog.Message },
  ClickedKeepEverything: {},
  SubmittedClearAll: {},
  SucceededClearAllData: {},
  FailedClearAllData: { reason: Schema.String },
})
export type Message = typeof Message.Type
