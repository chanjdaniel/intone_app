import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'

import { NativeCurve } from '../line/native'
import { AppRoute, Message, type Model, initialModel, update } from '../main'
import { FocusTakeControl, WaitForMicAnswer } from './commands'
import { managedResources } from './resources'
import { playOf } from './subscriptions'
import { Take, TakeResult, levelMeterFloorDb } from './take'
import { sampleCurve } from './testCurves'

// Listening and recording, by the Model: a voice plays only while the
// Model is in a playing state, the microphone is held only while it is in
// a recording one, and no state is both.

const line = AppRoute.Line({ clipId: 'ame-ga-suki', lineId: '1' })

const onLine = (take: Take = Take.Idle(), takesStarted = 1): Model => ({
  ...initialModel(line),
  native: NativeCurve.Ready({
    clipId: 'ame-ga-suki',
    lineId: '1',
    curve: sampleCurve,
  }),
  take,
  takesStarted,
})

const plays = (state: Model): string =>
  Option.match(playOf(state), {
    onNone: () => 'nothing',
    onSome: play => play._tag,
  })

const holdsMicrophone = (state: Model): boolean =>
  Option.isSome(managedResources.microphone.modelToMaybeRequirements(state))

const tracked = TakeResult.Tracked({ curve: sampleCurve })
const finished = Take.ShowingResult({ takeNumber: 1, result: tracked })

// One of every state a take can be in.
const everyState: ReadonlyArray<Take> = [
  Take.Idle(),
  Take.PlayingNative({ takeNumber: 1, tracker: 'Loading' }),
  Take.PlayingNative({ takeNumber: 1, tracker: 'Ready' }),
  Take.Preparing({ takeNumber: 1 }),
  Take.AwaitingMic({ takeNumber: 1 }),
  Take.MicPromptIgnored({ takeNumber: 1 }),
  Take.Recording({
    takeNumber: 1,
    elapsedSeconds: 1,
    levelDb: levelMeterFloorDb,
    maybeOnsetSeconds: Option.none(),
  }),
  Take.Analysing({ takeNumber: 1 }),
  finished,
  Take.Listening({ voice: 'Line', maybeTake: Option.none() }),
  Take.Listening({
    voice: 'Take',
    maybeTake: Option.some({ takeNumber: 1, result: tracked }),
  }),
  Take.MicDenied(),
  Take.NoMicDevice(),
  Take.MicFailed({ reason: 'busy' }),
  Take.AnalysisFailed({ reason: 'crashed' }),
]

const focused = Command.resolve(
  FocusTakeControl,
  Message.CompletedFocusTakeControl(),
)

describe('playing and recording', () => {
  test('never happen at once, in any state a take can be in', () => {
    const states = everyState.map(take => onLine(take))
    expect(states.filter(state => plays(state) !== 'nothing')).toHaveLength(4)
    expect(states.filter(holdsMicrophone)).toHaveLength(3)
    states.forEach(state => {
      expect(plays(state) !== 'nothing' && holdsMicrophone(state)).toBe(false)
    })
  })

  test.each(['Line', 'Take'] as const)(
    'listening to the %s is refused while the microphone is open',
    voice => {
      everyState
        .map(take => onLine(take))
        .filter(holdsMicrophone)
        .forEach(state => {
          expect(update(state, Message.ClickedListen({ voice }))).toStrictEqual(
            { model: state },
          )
        })
    },
  )

  test('pressing record while listening stops the voice and plays the line', () => {
    story(
      update,
      given(
        onLine(
          Take.Listening({
            voice: 'Take',
            maybeTake: Option.some({ takeNumber: 1, result: tracked }),
          }),
        ),
      ),
      message(Message.ClickedRecord()),
      focused,
      model(state => {
        expect(state.take).toStrictEqual(
          Take.PlayingNative({ takeNumber: 2, tracker: 'Loading' }),
        )
        expect(plays(state)).toBe('LineBeforeTake')
      }),
    )
  })

  test('the microphone waits for a tracker still loading when the line ends', () => {
    story(
      update,
      given(
        onLine(Take.PlayingNative({ takeNumber: 2, tracker: 'Loading' }), 2),
      ),
      message(Message.EndedNativeBeforeTake({ takeNumber: 2 })),
      focused,
      model(state => {
        expect(state.take).toStrictEqual(Take.Preparing({ takeNumber: 2 }))
        expect(plays(state)).toBe('nothing')
        expect(holdsMicrophone(state)).toBe(false)
      }),
      message(Message.AcquiredTracker()),
      focused,
      Command.resolve(
        WaitForMicAnswer,
        Message.CompletedWaitForMicAnswer({ takeNumber: 2 }),
      ),
      focused,
      model(state => expect(holdsMicrophone(state)).toBe(true)),
    )
  })

  test('a take waits for the line’s native curve', () => {
    const loading = {
      ...onLine(),
      native: NativeCurve.Loading({ clipId: 'ame-ga-suki', lineId: '1' }),
    }
    expect(update(loading, Message.ClickedRecord())).toStrictEqual({
      model: loading,
    })
  })
})

describe('listening again', () => {
  test('plays the line at the chosen speed, then shows the take it came from', () => {
    story(
      update,
      given(onLine(finished)),
      message(Message.SelectedListenSpeed({ speed: 0.5 })),
      message(Message.ClickedListen({ voice: 'Line' })),
      model(state => {
        expect(playOf(state)).toStrictEqual(
          Option.some({
            _tag: 'Line',
            audioUrl: expect.stringContaining('right'),
            rate: 0.5,
          }),
        )
      }),
      message(Message.EndedListening({ voice: 'Line' })),
      model(state => expect(state.take).toStrictEqual(finished)),
      Command.expectNone(),
    )
  })

  test('plays the take from memory, and stops when asked', () => {
    story(
      update,
      given(onLine(finished)),
      message(Message.ClickedListen({ voice: 'Take' })),
      model(state =>
        expect(playOf(state)).toStrictEqual(
          Option.some({ _tag: 'Take', takeNumber: 1 }),
        ),
      ),
      message(Message.ClickedStopListening()),
      model(state => {
        expect(state.take).toStrictEqual(finished)
        expect(plays(state)).toBe('nothing')
      }),
    )
  })

  test('has no take to hear before one has finished', () => {
    const idle = onLine()
    expect(
      update(idle, Message.ClickedListen({ voice: 'Take' })),
    ).toStrictEqual({ model: idle })
  })

  test('a line that will not play before a take ends the take and says why', () => {
    story(
      update,
      given(onLine(Take.PlayingNative({ takeNumber: 1, tracker: 'Ready' }))),
      message(Message.FailedPlayback({ reason: 'NotAllowedError' })),
      focused,
      model(state => {
        expect(state.take).toStrictEqual(Take.Idle())
        expect(state.maybePlaybackFailure).toStrictEqual(
          Option.some('NotAllowedError'),
        )
        expect(
          Option.isSome(
            managedResources.tracker.modelToMaybeRequirements(state),
          ),
        ).toBe(false)
      }),
      message(Message.ClickedListen({ voice: 'Line' })),
      model(state =>
        expect(state.maybePlaybackFailure).toStrictEqual(Option.none()),
      ),
    )
  })

  test('a voice that will not play while listening goes back and says why', () => {
    story(
      update,
      given(
        onLine(
          Take.Listening({
            voice: 'Take',
            maybeTake: Option.some({ takeNumber: 1, result: tracked }),
          }),
        ),
      ),
      message(
        Message.FailedPlayback({ reason: 'Your take is no longer in memory.' }),
      ),
      model(state => {
        expect(state.take).toStrictEqual(finished)
        expect(state.maybePlaybackFailure).toStrictEqual(
          Option.some('Your take is no longer in memory.'),
        )
      }),
    )
  })
})
