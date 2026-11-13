import { Schema } from 'effect'
import { Calendar } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { UrlRequest } from 'foldkit/navigation'
import { Url } from 'foldkit/url'

import { Dialog, FileDrop } from '@foldkit/ui'

import { TextChoice, TextModelId } from '../services/history-records'
import { MicrophoneFailure } from '../services/microphone'
import { ReviewDraft } from '../services/review-store'
import { ReviewVerdict } from '../services/starter-records'
import {
  BlindPoint,
  DayCount,
  LineNow,
  LineSummary,
  ShownTake,
  TrendPoint,
} from './history/history'
import { EdgeName } from './level/editor'
import { ClipSummary, LevelClip, LineStars } from './level/level'
import { LineProgress } from './level/progress'
import { PracticeLine } from './line/lines'
import { ListenSpeed, NativeFailure } from './line/native'
import { NextLine } from './line/place'
import { ReadingsShown, ShownWord } from './readings/readings'
import { LineReturn } from './returns/lineReturn'
import { DueLine } from './returns/returns'
import { SettingsFacts, StorageFacts } from './settings/settings'
import { Extent, TakeCurve, TakeFeatures, TakeResult, Voice } from './take/take'
import { TextStep } from './text/text'
import { PackStep, UploadStep } from './upload/upload'

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
    line: PracticeLine,
    curve: TakeCurve,
    features: TakeFeatures,
  },
  FailedLoadNativeCurve: {
    clipId: Schema.String,
    lineId: Schema.String,
    failure: NativeFailure,
    reason: Schema.String,
  },
  ClickedRetryNativeCurve: {},
  SucceededLoadLinePlace: {
    clipId: Schema.String,
    lineId: Schema.String,
    levelName: Schema.String,
    progress: LineProgress,
    maybeNext: Schema.Option(NextLine),
    today: Schema.String,
    maybeReturn: Schema.Option(LineReturn),
  },
  FailedLoadLinePlace: {
    clipId: Schema.String,
    lineId: Schema.String,
    reason: Schema.String,
  },
  ClickedListen: { voice: Voice, extent: Extent },
  ClickedStopListening: {},
  EndedListening: { voice: Voice, extent: Extent },
  SelectedListenSpeed: { speed: ListenSpeed },
  FailedPlayback: { reason: Schema.String },
  CompletedForgetTakeAudio: {},

  // Bringing a clip.
  GotUploadDropMessage: { message: FileDrop.Message },
  ProgressedUpload: { jobNumber: Schema.Finite, step: UploadStep },
  SucceededUpload: { jobNumber: Schema.Finite, clipId: Schema.String },
  FailedUpload: { jobNumber: Schema.Finite, reason: Schema.String },
  ClickedCancelUpload: {},
  GotPackDropMessage: { message: FileDrop.Message },
  GotPackFolderMessage: { message: FileDrop.Message },
  ProgressedPackImport: { jobNumber: Schema.Finite, step: PackStep },
  SucceededPackImport: { jobNumber: Schema.Finite, clipId: Schema.String },
  FailedPackImport: { jobNumber: Schema.Finite, reason: Schema.String },
  ClickedCancelPackImport: {},
  CompletedOpenLevel: {},
  CompletedFocusUploadStatus: {},

  // The clips and a clip's lines.
  // The lines due back, on the home screen.
  SucceededLoadDueLines: {
    today: Schema.String,
    lines: Schema.Array(DueLine),
    maybeNextOn: Schema.Option(Schema.String),
  },
  FailedLoadDueLines: { reason: Schema.String },
  ChangedFindDueLines: { words: Schema.String },
  CompletedReplaceDueFind: {},
  ClickedShowMoreDueLines: {},
  CompletedFocusDueRow: {},

  SucceededLoadClips: { clips: Schema.Array(ClipSummary) },
  FailedLoadClips: { reason: Schema.String },
  SucceededLoadLevel: {
    clipId: Schema.String,
    maybeClip: Schema.Option(LevelClip),
  },
  FailedLoadLevel: { clipId: Schema.String, reason: Schema.String },
  SucceededLoadLevelStars: {
    clipId: Schema.String,
    lines: Schema.Array(LineStars),
  },
  FailedLoadLevelStars: { clipId: Schema.String, reason: Schema.String },
  ChangedFindLevelLines: { words: Schema.String },
  CompletedReplaceLevelFind: {},
  ClickedShowMoreLevelLines: {},
  CompletedFocusLevelRow: {},
  ClickedDeleteClip: {},
  GotDeleteClipDialogMessage: { message: Dialog.Message },
  ClickedKeepClip: {},
  SubmittedDeleteClip: {},
  SucceededDeleteClip: { clipId: Schema.String, name: Schema.String },
  FailedDeleteClip: { clipId: Schema.String, reason: Schema.String },
  CompletedGoHome: {},

  // The line editor on a clip's level.
  AcquiredClipEditor: {
    clipId: Schema.String,
    peaks: Schema.instanceOf(Uint8Array<ArrayBufferLike>),
  },
  FailedAcquireClipEditor: { reason: Schema.String },
  ReleasedClipEditor: {},
  SelectedLevelLine: { lineId: Schema.String },
  ClickedEditLevelLine: { lineId: Schema.String },
  ClickedOpenLineEditor: {},
  ClickedPlayLevelLine: {},
  ClickedStopLevelLine: {},
  MovedLevelPlayhead: { playNumber: Schema.Finite, seconds: Schema.Finite },
  EndedLevelPlayback: { playNumber: Schema.Finite },
  FailedLevelPlayback: { playNumber: Schema.Finite, reason: Schema.String },
  PlacedLevelPlayhead: { seconds: Schema.Finite },
  MovedLineEdge: {
    lineId: Schema.String,
    edge: EdgeName,
    seconds: Schema.Finite,
  },
  SteppedLineEdge: {
    lineId: Schema.String,
    edge: EdgeName,
    step: Schema.Finite,
  },
  SteppedLevelPlayhead: { step: Schema.Finite },
  ReleasedLineEdge: {},
  CompletedWaitForKeysToRest: { draftNumber: Schema.Finite },
  ClickedSplitLine: {},
  ClickedMergeLines: { lineId: Schema.String, select: Schema.String },
  ClickedDeleteLine: {},
  ClickedUndoLineChange: {},
  SucceededEditClipLines: { clipId: Schema.String, clip: LevelClip },
  FailedEditClipLines: { clipId: Schema.String, reason: Schema.String },
  SucceededUndoClipLineChange: { clipId: Schema.String, clip: LevelClip },
  FailedUndoClipLineChange: { clipId: Schema.String, reason: Schema.String },
  CompletedFocusLineEditor: {},
  CompletedFollowLineEditorPointer: {},

  // The take.
  ClickedRecord: {},
  ClickedRecordBlind: {},
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
        lineNow: LineNow,
        trend: Schema.Array(TrendPoint),
        earlierTrend: Schema.Array(TrendPoint),
        blindTrend: Schema.Array(BlindPoint),
        maybeReturn: Schema.Option(LineReturn),
        today: Schema.String,
        drawnFrom: Schema.Literals(['Now', 'Earlier']),
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
  // RestoreBackup ended with no file chosen.
  CompletedRestoreBackup: {},
  FailedRestoreBackup: { reason: Schema.String },
  ClickedClearAll: {},
  GotClearDialogMessage: { message: Dialog.Message },
  ClickedKeepEverything: {},
  SubmittedClearAll: {},
  SucceededClearAllData: {},
  FailedClearAllData: { reason: Schema.String },

  // The text of the learner's clips.
  SucceededLoadTextChoice: {
    maybeChoice: Schema.Option(TextChoice),
    modelKept: Schema.Boolean,
  },
  FailedLoadTextChoice: { reason: Schema.String },
  ClickedWriteOutText: {},
  ClickedChooseTextModel: {},
  GotTextDialogMessage: { message: Dialog.Message },
  SelectedTextModel: { model: TextModelId },
  SubmittedTextDownload: {},
  ClickedNotNowText: {},
  SucceededSetTextChoice: {},
  FailedSetTextChoice: { reason: Schema.String },
  ProgressedTextJob: { jobNumber: Schema.Finite, step: TextStep },
  SucceededTextJob: {
    jobNumber: Schema.Finite,
    maybeClip: Schema.Option(LevelClip),
  },
  FailedTextJob: { jobNumber: Schema.Finite, reason: Schema.String },
  ClickedStopTextJob: {},
  ClickedEditLineText: { lineId: Schema.String },
  ClickedPasteText: {},
  ChangedTextDraft: { text: Schema.String },
  SubmittedLineText: {},
  ClickedCancelLineText: {},
  SucceededSetLineTexts: { clipId: Schema.String, clip: LevelClip },
  FailedSetLineTexts: { clipId: Schema.String, reason: Schema.String },
  CompletedFocusLineText: {},

  // A line's readings.
  SucceededLoadReadingsChoice: { maybeShown: Schema.Option(ReadingsShown) },
  FailedLoadReadingsChoice: { reason: Schema.String },
  ClickedShowReadings: {},
  ClickedHideReadings: {},
  SucceededSetReadingsChoice: {},
  FailedSetReadingsChoice: { reason: Schema.String },
  AcquiredReadings: {},
  ReleasedReadings: {},
  FailedAcquireReadings: { reason: Schema.String },
  SucceededReadLineReadings: {
    clipId: Schema.String,
    lineId: Schema.String,
    text: Schema.String,
    words: Schema.Array(ShownWord),
  },
  FailedReadLineReadings: {
    clipId: Schema.String,
    lineId: Schema.String,
    text: Schema.String,
    reason: Schema.String,
  },
  ClickedEditReadings: {},
  ChangedReadingDraft: { from: Schema.Finite, text: Schema.String },
  SubmittedReadings: {},
  ClickedCancelReadings: {},
  SucceededSetLineReadings: { clipId: Schema.String, lineId: Schema.String },
  FailedSetLineReadings: {
    clipId: Schema.String,
    lineId: Schema.String,
    reason: Schema.String,
  },
  CompletedFocusReadings: {},

  // The starter review, at /review.
  SucceededLoadReview: { draft: ReviewDraft },
  FailedLoadReview: { reason: Schema.String },
  ChangedReviewer: { name: Schema.String },
  ChoseReviewVerdict: { lineId: Schema.String, verdict: ReviewVerdict },
  ChoseReviewAccent: { lineId: Schema.String, accentType: Schema.String },
  ChangedReviewNote: { lineId: Schema.String, note: Schema.String },
  ClickedClearReviewVerdict: { lineId: Schema.String },
  SucceededSaveReview: {},
  FailedSaveReview: { reason: Schema.String },
  ClickedPlayReviewLine: { lineId: Schema.String },
  ClickedStopReviewLine: {},
  EndedReviewPlay: { playNumber: Schema.Finite },
  FailedReviewPlay: { playNumber: Schema.Finite, reason: Schema.String },
  ClickedExportReview: {},
  SucceededExportReview: { fileName: Schema.String, verdicts: Schema.Finite },
  FailedExportReview: { reason: Schema.String },
})
export type Message = typeof Message.Type
