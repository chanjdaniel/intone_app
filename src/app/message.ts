import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'
import { UrlRequest } from 'foldkit/navigation'
import { Url } from 'foldkit/url'

import { MicrophoneFailure } from '../services/microphone'
import { TakeResult } from './take/take'

const takeNumber = Schema.Finite

export const Message = defineMessageUnion({
  ClickedLink: { request: UrlRequest },
  ChangedUrl: { url: Url },
  CompletedNavigateInternal: {},
  CompletedLoadExternal: {},
  CompletedMountDevLibrary: {},
  FailedMountDevLibrary: { reason: Schema.String },

  // The take.
  ClickedRecord: {},
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
  CompletedPaintCurve: {},
  CompletedDrawLiveCurve: {},
})
export type Message = typeof Message.Type
