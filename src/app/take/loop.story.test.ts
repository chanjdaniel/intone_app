import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'

import { starThresholds } from '../../score/stars'
import { type LineProgress, noProgress } from '../level/progress'
import { NativeCurve } from '../line/native'
import { LinePlace } from '../line/place'
import { AppRoute, Message, type Model, initialModel, update } from '../main'
import { ReturnNote } from '../returns/lineReturn'
import { AskToPersistStorage } from '../settings/commands'
import type { StorageFacts } from '../settings/settings'
import { AnalyseTake, FocusTakeControl, WaitForMicAnswer } from './commands'
import {
  KeptInHistory,
  Take,
  TakeResult,
  TakeScore,
  isBlindUnderWay,
} from './take'
import {
  sampleCurve,
  sampleFeatures,
  sampleKept,
  sampleLine,
  sampleScore,
} from './testCurves'

// The practice loop's rules, by the Model (spec, "Testing Decisions"): a
// blind take shows nothing until it ends, then everything; stars follow
// the thresholds; a take that could not be compared never costs or
// earns a star; a personal best is marked only when beaten.

const line = { clipId: 'ame-ga-suki', lineId: '1' }

const placed = (progress: LineProgress): LinePlace =>
  LinePlace.Ready({
    ...line,
    levelName: '雨が好き',
    progress,
    maybeNext: Option.none(),
    today: '2026-11-10',
    maybeReturn: Option.none(),
  })

const onLine = (place: LinePlace = placed(noProgress)): Model => ({
  ...initialModel(AppRoute.Line(line)),
  native: NativeCurve.Ready({
    ...line,
    line: sampleLine,
    curve: sampleCurve,
    features: sampleFeatures,
  }),
  place,
})

const focused = Command.resolve(
  FocusTakeControl,
  Message.CompletedFocusTakeControl(),
)

const scoredAt = (match: number) => TakeScore.Scored({ ...sampleScore, match })

const kept = (score: TakeScore) =>
  TakeResult.Tracked({ curve: sampleCurve, score, kept: sampleKept })

const { reach, beat } = starThresholds()

const granted: StorageFacts = {
  persistence: 'Granted',
  maybeUsageBytes: Option.none(),
  maybeQuotaBytes: Option.none(),
  browser: 'Other',
}

// A take of `mode`, from the record button to its result.
const takeTo = (
  mode: 'Guided' | 'Blind',
  takeNumber: number,
  result: TakeResult,
) => [
  message(
    mode === 'Blind' ? Message.ClickedRecordBlind() : Message.ClickedRecord(),
  ),
  focused,
  message(Message.AcquiredTracker()),
  message(Message.EndedNativeBeforeTake({ takeNumber })),
  focused,
  Command.resolve(
    WaitForMicAnswer,
    Message.CompletedWaitForMicAnswer({ takeNumber }),
  ),
  focused,
  message(Message.AcquiredMicrophone()),
  focused,
  message(Message.ClickedStop()),
  focused,
  Command.resolve(
    AnalyseTake,
    Message.SucceededAnalyseTake({ takeNumber, result }),
  ),
  focused,
  ...(result._tag === 'Tracked' && result.kept._tag === 'Kept'
    ? [
        Command.resolve(
          AskToPersistStorage,
          Message.CompletedAskToPersistStorage({ storage: granted }),
        ),
      ]
    : []),
]

const outcomeOf = (state: Model) =>
  state.take._tag === 'ShowingResult' ? state.take.maybeOutcome : Option.none()

const progressOf = (state: Model): LineProgress =>
  state.place._tag === 'Ready' ? state.place.progress : noProgress

describe('a blind take', () => {
  test('hides the curves and all feedback from its start until it ends, then shows everything', () => {
    story(
      update,
      given(onLine()),
      message(Message.ClickedRecordBlind()),
      focused,
      model(state => {
        expect(state.take).toStrictEqual(
          Take.PlayingNative({
            mode: 'Blind',
            takeNumber: 1,
            tracker: 'Loading',
          }),
        )
        expect(isBlindUnderWay(state.take)).toBe(true)
      }),
      message(Message.AcquiredTracker()),
      message(Message.EndedNativeBeforeTake({ takeNumber: 1 })),
      focused,
      model(state => {
        expect(state.take).toStrictEqual(
          Take.AwaitingMic({ mode: 'Blind', takeNumber: 1 }),
        )
        expect(isBlindUnderWay(state.take)).toBe(true)
      }),
      Command.resolve(
        WaitForMicAnswer,
        Message.CompletedWaitForMicAnswer({ takeNumber: 1 }),
      ),
      focused,
      model(state => expect(isBlindUnderWay(state.take)).toBe(true)),
      message(Message.AcquiredMicrophone()),
      focused,
      message(
        Message.TickedTakeMeter({
          takeNumber: 1,
          elapsedSeconds: 0.5,
          levelDb: -12,
        }),
      ),
      message(Message.DetectedVoiceOnset({ takeNumber: 1, onsetSeconds: 0.2 })),
      model(state => {
        expect(state.take).toMatchObject({
          _tag: 'Recording',
          mode: 'Blind',
          levelDb: -12,
        })
        expect(isBlindUnderWay(state.take)).toBe(true)
      }),
      message(Message.ClickedStop()),
      focused,
      Command.expectExact(
        AnalyseTake({
          takeNumber: 1,
          mode: 'Blind',
          line: { ...line, lineText: sampleLine.historyText },
          native: { curve: sampleCurve, features: sampleFeatures },
        }),
      ),
      model(state => {
        expect(state.take).toStrictEqual(
          Take.Analysing({ mode: 'Blind', takeNumber: 1 }),
        )
        expect(isBlindUnderWay(state.take)).toBe(true)
      }),
      Command.resolve(
        AnalyseTake,
        Message.SucceededAnalyseTake({
          takeNumber: 1,
          result: kept(scoredAt(0.8)),
        }),
      ),
      focused,
      Command.resolve(
        AskToPersistStorage,
        Message.CompletedAskToPersistStorage({ storage: granted }),
      ),
      model(state => {
        expect(state.take).toMatchObject({
          _tag: 'ShowingResult',
          mode: 'Blind',
          result: kept(scoredAt(0.8)),
        })
        expect(isBlindUnderWay(state.take)).toBe(false)
      }),
    )
  })

  test('a guided take hides nothing', () => {
    story(
      update,
      given(onLine()),
      message(Message.ClickedRecord()),
      focused,
      model(state => expect(isBlindUnderWay(state.take)).toBe(false)),
      message(Message.AcquiredTracker()),
      message(Message.EndedNativeBeforeTake({ takeNumber: 1 })),
      focused,
      Command.resolve(
        WaitForMicAnswer,
        Message.CompletedWaitForMicAnswer({ takeNumber: 1 }),
      ),
      focused,
      message(Message.AcquiredMicrophone()),
      focused,
      model(state => {
        expect(state.take).toMatchObject({ _tag: 'Recording', mode: 'Guided' })
        expect(isBlindUnderWay(state.take)).toBe(false)
      }),
    )
  })
})

describe('stars', () => {
  test('one for reaching the threshold on a guided take, two for beating it, three for reaching it blind', () => {
    story(
      update,
      given(onLine()),
      ...takeTo('Guided', 1, kept(scoredAt(reach - 0.02))),
      model(state => {
        expect(progressOf(state).stars).toBe(0)
        expect(outcomeOf(state)).toStrictEqual(
          Option.some({
            starsBefore: 0,
            starsAfter: 0,
            maybePreviousBest: Option.none(),
            isPersonalBest: false,
            returnNote: ReturnNote.Quiet(),
          }),
        )
      }),
      ...takeTo('Guided', 2, kept(scoredAt(reach))),
      model(state => {
        expect(progressOf(state).stars).toBe(1)
        expect(outcomeOf(state)).toMatchObject(
          Option.some({ starsBefore: 0, starsAfter: 1 }),
        )
      }),
      ...takeTo('Blind', 3, kept(scoredAt(reach - 0.02))),
      model(state => expect(progressOf(state).stars).toBe(1)),
      ...takeTo('Guided', 4, kept(scoredAt(beat))),
      model(state => {
        expect(progressOf(state).stars).toBe(2)
        expect(outcomeOf(state)).toMatchObject(
          Option.some({ starsBefore: 1, starsAfter: 2 }),
        )
      }),
      ...takeTo('Guided', 5, kept(scoredAt(reach))),
      model(state => {
        expect(progressOf(state).stars).toBe(2)
        expect(outcomeOf(state)).toMatchObject(
          Option.some({ starsBefore: 2, starsAfter: 2 }),
        )
      }),
      ...takeTo('Blind', 6, kept(scoredAt(reach))),
      model(state => {
        expect(progressOf(state).stars).toBe(3)
        expect(outcomeOf(state)).toMatchObject(
          Option.some({ starsBefore: 2, starsAfter: 3 }),
        )
      }),
    )
  })

  test('a take that could not be compared neither costs nor earns a star, guided or blind', () => {
    const couldNotCompare = kept(
      TakeScore.CouldNotCompare({ version: 1, reason: 'TooLittleVoiced' }),
    )
    story(
      update,
      given(onLine(placed({ stars: 2, maybeBestMatch: Option.some(0.92) }))),
      ...takeTo('Blind', 1, couldNotCompare),
      model(state => {
        expect(progressOf(state)).toStrictEqual({
          stars: 2,
          maybeBestMatch: Option.some(0.92),
        })
        expect(outcomeOf(state)).toStrictEqual(
          Option.some({
            starsBefore: 2,
            starsAfter: 2,
            maybePreviousBest: Option.some(0.92),
            isPersonalBest: false,
            returnNote: ReturnNote.Quiet(),
          }),
        )
      }),
      ...takeTo('Guided', 2, couldNotCompare),
      model(state =>
        expect(progressOf(state)).toStrictEqual({
          stars: 2,
          maybeBestMatch: Option.some(0.92),
        }),
      ),
    )
    story(
      update,
      given(onLine()),
      ...takeTo('Guided', 1, couldNotCompare),
      model(state => expect(progressOf(state).stars).toBe(0)),
    )
  })

  test('a take the history could not keep moves nothing, and says nothing of stars', () => {
    story(
      update,
      given(onLine()),
      ...takeTo(
        'Blind',
        1,
        TakeResult.Tracked({
          curve: sampleCurve,
          score: scoredAt(1),
          kept: KeptInHistory.NotKept({ reason: 'The disk is full.' }),
        }),
      ),
      model(state => {
        expect(progressOf(state)).toStrictEqual(noProgress)
        expect(outcomeOf(state)).toStrictEqual(Option.none())
      }),
    )
  })

  test('a take before the line’s stars are read says nothing of them', () => {
    story(
      update,
      given(onLine(LinePlace.Loading(line))),
      ...takeTo('Guided', 1, kept(scoredAt(1))),
      model(state => {
        expect(state.place).toStrictEqual(LinePlace.Loading(line))
        expect(outcomeOf(state)).toStrictEqual(Option.none())
      }),
    )
  })
})

describe('a personal best', () => {
  test('is marked when a take beats the line’s best, and never on its first', () => {
    story(
      update,
      given(onLine()),
      ...takeTo('Guided', 1, kept(scoredAt(0.6))),
      model(state => {
        expect(outcomeOf(state)).toMatchObject(
          Option.some({ isPersonalBest: false }),
        )
        expect(progressOf(state).maybeBestMatch).toStrictEqual(Option.some(0.6))
      }),
      ...takeTo('Guided', 2, kept(scoredAt(0.7))),
      model(state => {
        expect(outcomeOf(state)).toMatchObject(
          Option.some({
            isPersonalBest: true,
            returnNote: ReturnNote.Quiet(),
            maybePreviousBest: Option.some(0.6),
          }),
        )
        expect(progressOf(state).maybeBestMatch).toStrictEqual(Option.some(0.7))
      }),
      ...takeTo('Blind', 3, kept(scoredAt(0.65))),
      model(state => {
        expect(outcomeOf(state)).toMatchObject(
          Option.some({ isPersonalBest: false }),
        )
        expect(progressOf(state).maybeBestMatch).toStrictEqual(Option.some(0.7))
      }),
      // Shown as the same 70%, so not a new best.
      ...takeTo('Guided', 4, kept(scoredAt(0.703))),
      model(state =>
        expect(outcomeOf(state)).toMatchObject(
          Option.some({ isPersonalBest: false }),
        ),
      ),
    )
  })

  test('stays with the result while its voices are listened to again', () => {
    story(
      update,
      given(onLine(placed({ stars: 0, maybeBestMatch: Option.some(0.5) }))),
      ...takeTo('Guided', 1, kept(scoredAt(0.8))),
      message(Message.ClickedListen({ voice: 'Take', extent: 'Whole' })),
      message(Message.EndedListening({ voice: 'Take', extent: 'Whole' })),
      model(state =>
        expect(outcomeOf(state)).toMatchObject(
          Option.some({ isPersonalBest: true, starsAfter: 1 }),
        ),
      ),
    )
  })
})

describe('a line that comes back', () => {
  const dueSince = (dueOn: string, today: string) =>
    LinePlace.Ready({
      ...line,
      levelName: '雨が好き',
      progress: { stars: 3, maybeBestMatch: Option.some(0.8) },
      maybeNext: Option.none(),
      today,
      maybeReturn: Option.some({ streak: 2, setOn: '2026-11-11', dueOn }),
    })

  const keptOn = (score: TakeScore, day: string) =>
    TakeResult.Tracked({
      curve: sampleCurve,
      score,
      kept: KeptInHistory.Kept({ ...sampleKept, day }),
    })

  const returnOf = (state: Model) =>
    state.place._tag === 'Ready' ? state.place.maybeReturn : Option.none()

  const noteOf = (state: Model) =>
    Option.map(outcomeOf(state), outcome => outcome.returnNote)

  test('a due line, after a blind take that reaches its threshold, comes back after the next step', () => {
    story(
      update,
      given(onLine(dueSince('2026-11-14', '2026-11-14'))),
      ...takeTo('Blind', 1, keptOn(scoredAt(reach), '2026-11-14')),
      model(state => {
        expect(returnOf(state)).toStrictEqual(
          Option.some({ streak: 3, setOn: '2026-11-14', dueOn: '2026-11-21' }),
        )
        expect(noteOf(state)).toStrictEqual(
          Option.some(ReturnNote.ComesBack({ on: '2026-11-21' })),
        )
      }),
    )
  })

  test('a line due a week ago, after a blind take that misses, comes back the next day', () => {
    story(
      update,
      given(onLine(dueSince('2026-11-14', '2026-11-21'))),
      ...takeTo('Blind', 1, keptOn(scoredAt(reach - 0.1), '2026-11-21')),
      model(state => {
        expect(returnOf(state)).toStrictEqual(
          Option.some({ streak: 0, setOn: '2026-11-21', dueOn: '2026-11-22' }),
        )
        expect(progressOf(state).stars).toBe(3)
      }),
    )
  })

  test('a guided take on a due line is not its return, and says so', () => {
    story(
      update,
      given(onLine(dueSince('2026-11-14', '2026-11-14'))),
      ...takeTo('Guided', 1, keptOn(scoredAt(beat), '2026-11-14')),
      model(state => {
        expect(returnOf(state)).toStrictEqual(
          Option.some({ streak: 2, setOn: '2026-11-11', dueOn: '2026-11-14' }),
        )
        expect(noteOf(state)).toStrictEqual(Option.some(ReturnNote.StillDue()))
      }),
    )
  })

  test('a first blind take starts the line’s returns, and one not compared moves nothing', () => {
    story(
      update,
      given(onLine()),
      ...takeTo(
        'Blind',
        1,
        keptOn(
          TakeScore.CouldNotCompare({ version: 1, reason: 'TooQuiet' }),
          '2026-11-10',
        ),
      ),
      model(state => {
        expect(returnOf(state)).toStrictEqual(Option.none())
        expect(noteOf(state)).toStrictEqual(Option.some(ReturnNote.Quiet()))
      }),
      ...takeTo('Blind', 2, keptOn(scoredAt(reach), '2026-11-10')),
      model(state => {
        expect(returnOf(state)).toStrictEqual(
          Option.some({ streak: 1, setOn: '2026-11-10', dueOn: '2026-11-11' }),
        )
      }),
    )
  })
})
