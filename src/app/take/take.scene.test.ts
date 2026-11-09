import { Option } from 'effect'
import {
  Command,
  ManagedResource,
  Mount,
  Subscription,
  click,
  expect,
  given,
  role,
  scene,
  text,
} from 'foldkit/scene'
import { describe, test } from 'vitest'

import { MicrophoneError } from '../../services/microphone'
import { NativeCurve } from '../line/native'
import {
  AppRoute,
  Message,
  type Model,
  initialModel,
  update,
  view,
} from '../main'
import { AskToPersistStorage } from '../settings/commands'
import type { StorageFacts } from '../settings/settings'
import { AnalyseTake, FocusTakeControl, WaitForMicAnswer } from './commands'
import { DrawCurvePair } from './curvePair'
import { managedResources } from './resources'
import { Take, TakeResult, levelMeterFloorDb } from './take'
import {
  sampleCurve,
  sampleFeatures,
  sampleKept,
  sampleLine,
  sampleScore,
} from './testCurves'

// The native as the take is scored against it.
const nativeRecording = { curve: sampleCurve, features: sampleFeatures }

// The bundled line's practice screen, its native curve ready.
const onLine = (take: Take = Take.Idle(), takesStarted = 0): Model => ({
  ...initialModel(AppRoute.Line({ clipId: 'ame-ga-suki', lineId: '1' })),
  native: NativeCurve.Ready({
    clipId: 'ame-ga-suki',
    lineId: '1',
    line: sampleLine,
    curve: sampleCurve,
    features: sampleFeatures,
  }),
  take,
  takesStarted,
})

const drawn = Mount.resolve(DrawCurvePair, Message.CompletedDrawCurvePair())

const focused = Command.resolve(
  FocusTakeControl,
  Message.CompletedFocusTakeControl(),
)

const grantedStorage: StorageFacts = {
  persistence: 'Granted',
  maybeUsageBytes: Option.some(120_000),
  maybeQuotaBytes: Option.some(1e9),
  browser: 'Other',
}

// A short curve: silence, a rise and a fall, silence.
const curve = {
  frameHz: 62.5,
  f0Hz: [0, 0, 100, 110, 120, 0, 115, 100, 90, 0],
  confidence: [0, 0, 0.9, 0.9, 0.9, 0.2, 0.9, 0.9, 0.9, 0],
  levelDb: [-90, -90, -20, -20, -20, -40, -20, -20, -20, -90],
  onsetFrame: 2,
}

const recordButton = role('button', { name: 'Record' })
const liveCurve = role('img', {
  name: /^Your pitch, drawn as you speak over the line's/,
})
const lineCurve = role('img', {
  name: "The line's pitch curve, from the speaker's voice onset, in semitones around their typical pitch of 200 Hz.",
})
const meter = role('meter', { name: 'Microphone level' })
const stopButton = role('button', { name: 'Stop' })

describe('a take', () => {
  test('goes from record to its curve, holding the microphone only while it records', () => {
    scene(
      { update, view },
      given(onLine()),
      drawn,
      expect(role('heading', { name: 'Copy the line' })).toExist(),
      expect(lineCurve).toExist(),
      expect(liveCurve).toBeAbsent(),
      click(recordButton),
      focused,
      expect(role('heading', { name: 'Listen to the line' })).toExist(),
      ManagedResource.acquire(managedResources.tracker),
      Subscription.emit(Message.EndedNativeBeforeTake({ takeNumber: 1 })),
      Command.expectHas(WaitForMicAnswer({ takeNumber: 1 })),
      focused,
      Command.resolve(
        WaitForMicAnswer,
        Message.CompletedWaitForMicAnswer({ takeNumber: 1 }),
      ),
      expect(
        role('heading', { name: 'Still waiting for the microphone' }),
      ).toExist(),
      focused,
      ManagedResource.acquire(managedResources.microphone),
      focused,
      expect(role('heading', { name: 'Recording' })).toExist(),
      expect(liveCurve).toExist(),
      expect(lineCurve).toExist(),
      expect(
        text(
          'Your curve starts when you start to speak, a moment behind your voice.',
        ),
      ).toExist(),
      expect(meter).toHaveAttr('aria-valuetext', 'silent'),
      Subscription.emit(
        Message.TickedTakeMeter({
          takeNumber: 1,
          elapsedSeconds: 2.4,
          levelDb: -14,
        }),
      ),
      expect(role('timer')).toHaveText('0:02 of 0:30'),
      expect(text('Say the line, then press stop.')).toExist(),
      expect(meter).toHaveAttr('aria-valuenow', '-14'),
      expect(meter).toHaveAttr('aria-valuetext', 'good'),
      Subscription.emit(
        Message.DetectedVoiceOnset({ takeNumber: 1, onsetSeconds: 0.5 }),
      ),
      expect(text(/^Your curve, as you speak\. Each curve starts/)).toExist(),
      click(stopButton),
      Command.expectHas(
        AnalyseTake({
          takeNumber: 1,
          line: { clipId: 'ame-ga-suki', lineId: '1', lineText: '雨が好き' },
          native: nativeRecording,
        }),
      ),
      focused,
      expect(role('heading', { name: 'Finding your pitch' })).toExist(),
      // The live curve stays while the take is tracked, without the
      // meter: the microphone is off.
      expect(liveCurve).toExist(),
      expect(meter).toBeAbsent(),
      Command.resolve(
        AnalyseTake,
        Message.SucceededAnalyseTake({
          takeNumber: 1,
          result: TakeResult.Tracked({
            curve,
            score: sampleScore,
            kept: sampleKept,
          }),
        }),
      ),
      focused,
      // A kept take asks the browser to keep the history.
      Command.resolve(
        AskToPersistStorage,
        Message.CompletedAskToPersistStorage({ storage: grantedStorage }),
      ),
      ManagedResource.release(managedResources.microphone),
      expect(role('heading', { name: 'Your copy' })).toExist(),
      expect(text('82% match to this clip')).toExist(),
      expect(
        role('img', {
          name: "Your pitch curve, lined up with the line's where the two were compared, in semitones around your typical pitch of 105 Hz, coloured blue where it is close to the line and orange where it is far. The stretch where it differed most is shaded.",
        }),
      ).toExist(),
      expect(lineCurve).toExist(),
      expect(role('button', { name: 'Hear your take' })).toBeEnabled(),
      ManagedResource.release(managedResources.tracker),
      expect(role('button', { name: 'Record again' })).toExist(),
    )
  })

  test('releases the microphone and the tracker when the microphone is refused', () => {
    scene(
      { update, view },
      given(onLine(Take.AwaitingMic({ takeNumber: 3 }), 3)),
      drawn,
      ManagedResource.failAcquire(
        managedResources.microphone,
        new MicrophoneError({
          failure: 'Denied',
          message: 'Permission denied',
        }),
      ),
      focused,
      expect(role('heading', { name: 'The microphone is blocked' })).toExist(),
      expect(
        text(
          'To allow it, open the site settings from the icon left of the address, set Microphone to Allow, then try again.',
        ),
      ).toExist(),
      ManagedResource.release(managedResources.microphone),
      ManagedResource.release(managedResources.tracker),
      click(role('button', { name: 'Try again' })),
      focused,
      expect(role('heading', { name: 'Listen to the line' })).toExist(),
    )
  })

  test('releases the microphone and the tracker when the recording fails', () => {
    scene(
      { update, view },
      given(
        onLine(
          Take.Recording({
            takeNumber: 2,
            elapsedSeconds: 1,
            levelDb: levelMeterFloorDb,
            maybeOnsetSeconds: Option.none(),
          }),
          2,
        ),
      ),
      drawn,
      Subscription.emit(
        Message.FailedRecordTake({
          takeNumber: 2,
          reason: 'The take lost its microphone.',
        }),
      ),
      focused,
      expect(
        role('heading', { name: 'Your take could not be tracked' }),
      ).toExist(),
      expect(text('The take lost its microphone.')).toExist(),
      ManagedResource.release(managedResources.microphone),
      ManagedResource.release(managedResources.tracker),
    )
  })

  test('releases both when the learner cancels while the browser asks', () => {
    scene(
      { update, view },
      given(onLine(Take.MicPromptIgnored({ takeNumber: 1 }), 1)),
      drawn,
      click(role('button', { name: 'Cancel' })),
      focused,
      ManagedResource.release(managedResources.microphone),
      ManagedResource.release(managedResources.tracker),
      expect(recordButton).toExist(),
    )
  })

  test('releases the tracker when it cannot start, and says so', () => {
    scene(
      { update, view },
      given(onLine(Take.Preparing({ takeNumber: 1 }), 1)),
      drawn,
      ManagedResource.failAcquire(
        managedResources.tracker,
        new Error('The pitch model did not load'),
      ),
      focused,
      expect(
        text('The pitch tracker did not start: The pitch model did not load'),
      ).toExist(),
      ManagedResource.release(managedResources.tracker),
    )
  })
})

describe('the mic state panel', () => {
  test.each([
    [
      Take.NoMicDevice(),
      'No microphone found',
      'Connect a microphone or a headset with one, then try again.',
      'Try again',
    ],
    [
      Take.MicFailed({ reason: 'Could not start audio source' }),
      'The microphone did not start',
      'The browser said: Could not start audio source',
      'Try again',
    ],
    [
      Take.AwaitingMic({ takeNumber: 1 }),
      'Allow the microphone',
      'Your browser is asking to use the microphone. Choose Allow to start the take.',
      'Cancel',
    ],
    [
      Take.ShowingResult({ takeNumber: 1, result: TakeResult.TooQuiet() }),
      'That take was too quiet to track',
      'The microphone hardly heard you. Move closer to it or speak up, then record again.',
      'Record again',
    ],
    [
      Take.ShowingResult({ takeNumber: 1, result: TakeResult.TooNoisy() }),
      'That take was too noisy to track',
      'There was more sound around you than voice. Try somewhere quieter, or closer to the microphone.',
      'Record again',
    ],
  ])('shows %o as its own screen', (take, heading, line, button) => {
    scene(
      { update, view },
      given(onLine(take, 1)),
      drawn,
      expect(role('heading', { name: heading, level: 2 })).toExist(),
      expect(text(line)).toExist(),
      expect(role('button', { name: button })).toExist(),
    )
  })

  test('says it is analysing, with nothing to press, once the microphone is off', () => {
    scene(
      { update, view },
      given(onLine(Take.Analysing({ takeNumber: 1 }), 1)),
      drawn,
      expect(role('heading', { name: 'Finding your pitch' })).toExist(),
      expect(text('The microphone is off. Tracking your take now.')).toExist(),
      expect(role('button', { name: 'Stop' })).toBeAbsent(),
      expect(role('button', { name: 'Record' })).toBeAbsent(),
      expect(role('button', { name: 'Hear the line' })).toBeDisabled(),
    )
  })
})
