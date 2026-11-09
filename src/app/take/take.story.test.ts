import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { fromString } from 'foldkit/url'
import { describe, expect, test } from 'vitest'

import { AppRoute, Message, type Model, update } from '../main'
import { AnalyseTake, FocusTakeControl, WaitForMicAnswer } from './commands'
import { managedResources } from './resources'
import { Take, TakeResult, levelMeterFloorDb } from './take'

const home = (take: Take = Take.Idle(), takesStarted = 0): Model => ({
  route: AppRoute.Home(),
  maybeDevLibraryFailure: Option.none(),
  take,
  takesStarted,
})

// What the runtime would hold for this Model.
const holds = (state: Model) => ({
  tracker: Option.isSome(
    managedResources.tracker.modelToMaybeRequirements(state),
  ),
  microphone: Option.isSome(
    managedResources.microphone.modelToMaybeRequirements(state),
  ),
})

const focused = Command.resolve(
  FocusTakeControl,
  Message.CompletedFocusTakeControl(),
)

const url = (path: string) =>
  Option.getOrThrow(fromString(`http://localhost${path}`))

describe('the take, by its Model', () => {
  test('holds the tracker from record to the curve, and the microphone only from asking to stop', () => {
    story(
      update,
      given(home()),
      message(Message.ClickedRecord()),
      focused,
      model(state => {
        expect(state.take).toStrictEqual(Take.Preparing({ takeNumber: 1 }))
        expect(holds(state)).toStrictEqual({ tracker: true, microphone: false })
      }),
      message(Message.AcquiredTracker()),
      focused,
      model(state =>
        expect(holds(state)).toStrictEqual({ tracker: true, microphone: true }),
      ),
      Command.resolve(
        WaitForMicAnswer,
        Message.CompletedWaitForMicAnswer({ takeNumber: 1 }),
      ),
      focused,
      model(state =>
        expect(state.take).toStrictEqual(
          Take.MicPromptIgnored({ takeNumber: 1 }),
        ),
      ),
      message(Message.AcquiredMicrophone()),
      focused,
      model(state => {
        expect(state.take._tag).toBe('Recording')
        expect(holds(state)).toStrictEqual({ tracker: true, microphone: true })
      }),
      message(Message.ClickedStop()),
      focused,
      model(state => {
        expect(state.take).toStrictEqual(Take.Analysing({ takeNumber: 1 }))
        expect(holds(state)).toStrictEqual({ tracker: true, microphone: false })
      }),
      Command.resolve(
        AnalyseTake,
        Message.SucceededAnalyseTake({
          takeNumber: 1,
          result: TakeResult.TooQuiet(),
        }),
      ),
      focused,
      model(state =>
        expect(holds(state)).toStrictEqual({
          tracker: false,
          microphone: false,
        }),
      ),
    )
  })

  test.each(['/elsewhere', '/dev'])(
    'releases both when the learner leaves the screen for %s mid-take',
    path => {
      story(
        update,
        given(
          home(
            Take.Recording({
              takeNumber: 4,
              elapsedSeconds: 3,
              levelDb: levelMeterFloorDb,
              maybeOnsetSeconds: Option.none(),
            }),
            4,
          ),
        ),
        message(Message.ChangedUrl({ url: url(path) })),
        model(state => {
          expect(state.take).toStrictEqual(Take.Idle())
          expect(holds(state)).toStrictEqual({
            tracker: false,
            microphone: false,
          })
        }),
      )
    },
  )

  test('keeps a finished result when the learner leaves and comes back', () => {
    const result = Take.ShowingResult({
      takeNumber: 1,
      result: TakeResult.TooNoisy(),
    })
    story(
      update,
      given(home(result, 1)),
      message(Message.ChangedUrl({ url: url('/elsewhere') })),
      message(Message.ChangedUrl({ url: url('/') })),
      model(state => expect(state.take).toStrictEqual(result)),
    )
  })

  test('says the prompt is waiting only if it is still unanswered for this take', () => {
    // The microphone answered first: the timer, when it ends, changes
    // nothing.
    const recording = home(
      Take.Recording({
        takeNumber: 2,
        elapsedSeconds: 1,
        levelDb: levelMeterFloorDb,
        maybeOnsetSeconds: Option.none(),
      }),
      2,
    )
    expect(
      update(recording, Message.CompletedWaitForMicAnswer({ takeNumber: 2 })),
    ).toStrictEqual({ model: recording })
    story(
      update,
      given(home(Take.AwaitingMic({ takeNumber: 3 }), 3)),
      message(Message.CompletedWaitForMicAnswer({ takeNumber: 2 })),
      model(state =>
        expect(state.take).toStrictEqual(Take.AwaitingMic({ takeNumber: 3 })),
      ),
      message(Message.CompletedWaitForMicAnswer({ takeNumber: 3 })),
      focused,
      model(state =>
        expect(state.take).toStrictEqual(
          Take.MicPromptIgnored({ takeNumber: 3 }),
        ),
      ),
    )
  })

  test('ignores a result that comes back for an earlier take', () => {
    story(
      update,
      given(home(Take.Analysing({ takeNumber: 5 }), 5)),
      message(
        Message.SucceededAnalyseTake({
          takeNumber: 4,
          result: TakeResult.TooQuiet(),
        }),
      ),
      message(Message.FailedAnalyseTake({ takeNumber: 4, reason: 'late' })),
      model(state =>
        expect(state.take).toStrictEqual(Take.Analysing({ takeNumber: 5 })),
      ),
    )
  })

  test('stops a take by itself at 30 seconds', () => {
    story(
      update,
      given(
        home(
          Take.Recording({
            takeNumber: 1,
            elapsedSeconds: 29.8,
            levelDb: levelMeterFloorDb,
            maybeOnsetSeconds: Option.none(),
          }),
          1,
        ),
      ),
      message(
        Message.TickedTakeMeter({
          takeNumber: 1,
          elapsedSeconds: 30.05,
          levelDb: -20,
        }),
      ),
      Command.expectExact(AnalyseTake({ takeNumber: 1 }), FocusTakeControl()),
      model(state => {
        expect(state.take).toStrictEqual(Take.Analysing({ takeNumber: 1 }))
        expect(holds(state).microphone).toBe(false)
      }),
      focused,
      Command.resolve(
        AnalyseTake,
        Message.FailedAnalyseTake({ takeNumber: 1, reason: 'no matter' }),
      ),
      focused,
    )
  })

  test('starts no second take while one is under way', () => {
    story(
      update,
      given(
        home(
          Take.Recording({
            takeNumber: 1,
            elapsedSeconds: 1,
            levelDb: levelMeterFloorDb,
            maybeOnsetSeconds: Option.none(),
          }),
          1,
        ),
      ),
      message(Message.ClickedRecord()),
      model(state => {
        expect(state.takesStarted).toBe(1)
        expect(state.take._tag).toBe('Recording')
      }),
      Command.expectNone(),
    )
  })

  test('holds nothing off the home screen, whatever the take says', () => {
    const elsewhere: Model = {
      ...home(
        Take.Recording({
          takeNumber: 1,
          elapsedSeconds: 1,
          levelDb: levelMeterFloorDb,
          maybeOnsetSeconds: Option.none(),
        }),
        1,
      ),
      route: AppRoute.NotFound({ path: '/elsewhere' }),
    }
    expect(holds(elsewhere)).toStrictEqual({
      tracker: false,
      microphone: false,
    })
  })
})
