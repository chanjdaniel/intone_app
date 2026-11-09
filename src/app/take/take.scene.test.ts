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
import { AppRoute, Message, type Model, update, view } from '../main'
import { AnalyseTake, FocusTakeControl, WaitForMicAnswer } from './commands'
import { PaintCurve } from './curveView'
import { managedResources } from './resources'
import { Take, TakeResult } from './take'

const home = (take: Take = Take.Idle(), takesStarted = 0): Model => ({
  route: AppRoute.Home(),
  maybeDevLibraryFailure: Option.none(),
  take,
  takesStarted,
})

const focused = Command.resolve(
  FocusTakeControl,
  Message.CompletedFocusTakeControl(),
)

// A short curve: silence, a rise and a fall, silence.
const curve = {
  frameHz: 62.5,
  f0Hz: [0, 0, 100, 110, 120, 0, 115, 100, 90, 0],
  confidence: [0, 0, 0.9, 0.9, 0.9, 0.2, 0.9, 0.9, 0.9, 0],
  levelDb: [-90, -90, -20, -20, -20, -40, -20, -20, -20, -90],
  onsetFrame: 2,
}

const recordButton = role('button', { name: 'Record' })
const stopButton = role('button', { name: 'Stop' })

describe('a take', () => {
  test('goes from record to its curve, holding the microphone only while it records', () => {
    scene(
      { update, view },
      given(home()),
      expect(role('heading', { name: 'Record a take' })).toExist(),
      click(recordButton),
      focused,
      expect(role('heading', { name: 'Getting ready' })).toExist(),
      ManagedResource.acquire(managedResources.tracker),
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
      Subscription.emit(
        Message.TickedRecordingClock({ takeNumber: 1, elapsedSeconds: 2.4 }),
      ),
      expect(text('0:02 of 0:30. Say your line, then press stop.')).toExist(),
      click(stopButton),
      Command.expectHas(AnalyseTake({ takeNumber: 1 })),
      focused,
      expect(role('heading', { name: 'Finding your pitch' })).toExist(),
      Command.resolve(
        AnalyseTake,
        Message.SucceededAnalyseTake({
          takeNumber: 1,
          result: TakeResult.Tracked({ curve }),
        }),
      ),
      focused,
      Mount.resolve(PaintCurve, Message.CompletedPaintCurve()),
      ManagedResource.release(managedResources.microphone),
      expect(role('heading', { name: 'Your pitch' })).toExist(),
      expect(
        role('img', {
          name: 'Your pitch curve, 0.10 s from your voice onset, in semitones around your typical pitch of 105 Hz.',
        }),
      ).toExist(),
      ManagedResource.release(managedResources.tracker),
      expect(role('button', { name: 'Record again' })).toExist(),
    )
  })

  test('releases the microphone and the tracker when the microphone is refused', () => {
    scene(
      { update, view },
      given(home(Take.AwaitingMic({ takeNumber: 3 }), 3)),
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
      expect(role('heading', { name: 'Getting ready' })).toExist(),
    )
  })

  test('releases the microphone and the tracker when the recording fails', () => {
    scene(
      { update, view },
      given(home(Take.Recording({ takeNumber: 2, elapsedSeconds: 1 }), 2)),
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
      given(home(Take.MicPromptIgnored({ takeNumber: 1 }), 1)),
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
      given(home(Take.Preparing({ takeNumber: 1 }), 1)),
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
      given(home(take, 1)),
      expect(role('heading', { name: heading, level: 2 })).toExist(),
      expect(text(line)).toExist(),
      expect(role('button', { name: button })).toExist(),
    )
  })

  test('says it is analysing, with nothing to press, once the microphone is off', () => {
    scene(
      { update, view },
      given(home(Take.Analysing({ takeNumber: 1 }), 1)),
      expect(role('heading', { name: 'Finding your pitch' })).toExist(),
      expect(text('The microphone is off. Tracking your take now.')).toExist(),
      expect(role('button')).toBeAbsent(),
    )
  })
})
