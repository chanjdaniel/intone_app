import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'
import { UrlRequest } from 'foldkit/navigation'
import { Url } from 'foldkit/url'

import { MicrophoneFailure } from '../services/microphone'
import { ListenSpeed } from './line/native'
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
})
export type Message = typeof Message.Type
