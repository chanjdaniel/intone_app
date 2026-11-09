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

import { type LineProgress, noProgress } from '../level/progress'
import { NativeCurve } from '../line/native'
import { LinePlace, type NextLine } from '../line/place'
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
import { Take, TakeResult, TakeScore } from './take'
import {
  sampleCurve,
  sampleFeatures,
  sampleKept,
  sampleLine,
  sampleScore,
} from './testCurves'

// The practice loop on the screen: a blind take shows no curve, no
// level and no closeness until it ends, then everything; the line's
// stars and best above the curves; what a take did for them, said once
// with its score; and the next line.

const line = { clipId: 'ame-ga-suki', lineId: '1' }

const placed = (
  progress: LineProgress,
  maybeNext: Option.Option<NextLine> = Option.none(),
): LinePlace =>
  LinePlace.Ready({ ...line, levelName: '雨が好き', progress, maybeNext })

const onLine = (
  take: Take = Take.Idle(),
  place = placed(noProgress),
): Model => ({
  ...initialModel(AppRoute.Line(line)),
  native: NativeCurve.Ready({
    ...line,
    line: sampleLine,
    curve: sampleCurve,
    features: sampleFeatures,
  }),
  place,
  take,
  takesStarted: 1,
})

const drawn = Mount.resolve(DrawCurvePair, Message.CompletedDrawCurvePair())
const focused = Command.resolve(
  FocusTakeControl,
  Message.CompletedFocusTakeControl(),
)

const granted: StorageFacts = {
  persistence: 'Granted',
  maybeUsageBytes: Option.none(),
  maybeQuotaBytes: Option.none(),
  browser: 'Other',
}

const lineCurve = role('img', { name: /^The line's pitch curve/ })
const learnerCurve = role('img', { name: /^Your pitch/ })
const meter = role('meter', { name: 'Microphone level' })
const cover = text('A blind take', { exact: true })

describe('a blind take on the screen', () => {
  test('shows no curve, level or closeness from its start until it ends, then everything', () => {
    scene(
      { update, view },
      given(onLine()),
      drawn,
      expect(lineCurve).toExist(),
      click(role('button', { name: 'Record blind' })),
      focused,
      Mount.expectEnded(DrawCurvePair),
      expect(role('heading', { name: 'Listen to the line' })).toExist(),
      expect(
        text(/^This take is blind: the curves and the level stay hidden/),
      ).toExist(),
      expect(cover).toExist(),
      expect(lineCurve).toBeAbsent(),
      ManagedResource.acquire(managedResources.tracker),
      Subscription.emit(Message.EndedNativeBeforeTake({ takeNumber: 2 })),
      focused,
      Command.resolve(
        WaitForMicAnswer,
        Message.CompletedWaitForMicAnswer({ takeNumber: 2 }),
      ),
      focused,
      ManagedResource.acquire(managedResources.microphone),
      focused,
      Subscription.emit(
        Message.TickedTakeMeter({
          takeNumber: 2,
          elapsedSeconds: 1.2,
          levelDb: -14,
        }),
      ),
      Subscription.emit(
        Message.DetectedVoiceOnset({ takeNumber: 2, onsetSeconds: 0.3 }),
      ),
      expect(role('heading', { name: 'Recording blind' })).toExist(),
      expect(role('timer')).toHaveText('0:01 of 0:30'),
      expect(meter).toBeAbsent(),
      expect(lineCurve).toBeAbsent(),
      expect(learnerCurve).toBeAbsent(),
      expect(cover).toExist(),
      click(role('button', { name: 'Stop' })),
      focused,
      expect(role('heading', { name: 'Finding your pitch' })).toExist(),
      expect(learnerCurve).toBeAbsent(),
      expect(cover).toExist(),
      Command.resolve(
        AnalyseTake,
        Message.SucceededAnalyseTake({
          takeNumber: 2,
          result: TakeResult.Tracked({
            curve: sampleCurve,
            score: sampleScore,
            kept: sampleKept,
          }),
        }),
      ),
      focused,
      drawn,
      Command.resolve(
        AskToPersistStorage,
        Message.CompletedAskToPersistStorage({ storage: granted }),
      ),
      ManagedResource.release(managedResources.microphone),
      ManagedResource.release(managedResources.tracker),
      expect(role('heading', { name: 'Your copy, blind' })).toExist(),
      expect(cover).toBeAbsent(),
      expect(lineCurve).toExist(),
      expect(
        role('img', {
          name: /^Your pitch curve, lined up with the line's .* coloured blue where it is close to the line and orange where it is far\./,
        }),
      ).toExist(),
      expect(role('status')).toContainText('82% match to this clip'),
      expect(role('status')).toContainText(
        'Three stars for this line: 75% or more on a blind take.',
      ),
      expect(role('button', { name: 'Record again' })).toExist(),
      expect(role('button', { name: 'Record blind' })).toExist(),
    )
  })

  test('a guided take keeps the curves and the level', () => {
    scene(
      { update, view },
      given(
        onLine(
          Take.Recording({
            mode: 'Guided',
            takeNumber: 1,
            elapsedSeconds: 1,
            levelDb: -14,
            maybeOnsetSeconds: Option.none(),
          }),
        ),
      ),
      drawn,
      expect(role('heading', { name: 'Recording' })).toExist(),
      expect(meter).toExist(),
      expect(lineCurve).toExist(),
      expect(learnerCurve).toExist(),
      expect(cover).toBeAbsent(),
    )
  })
})

describe('the line’s stars on its practice screen', () => {
  test('shows its stars, its best and how each star is earned', () => {
    scene(
      { update, view },
      given(
        onLine(
          Take.Idle(),
          placed({ stars: 2, maybeBestMatch: Option.some(0.92) }),
        ),
      ),
      drawn,
      expect(role('img', { name: '2 of 3 stars' })).toExist(),
      expect(text('Best 92%')).toExist(),
      expect(text('One star for 75% on a guided take.')).toExist(),
      expect(text('Two for 90% on a guided take.')).toExist(),
      expect(
        text('Three for 75% on a blind take, with the curves hidden.'),
      ).toExist(),
    )
  })

  test('says what a take did for them with its score, and a new personal best', () => {
    scene(
      { update, view },
      given(
        onLine(
          Take.ShowingResult({
            takeNumber: 1,
            mode: 'Guided',
            result: TakeResult.Tracked({
              curve: sampleCurve,
              score: sampleScore,
              kept: sampleKept,
            }),
            maybeOutcome: Option.some({
              starsBefore: 0,
              starsAfter: 1,
              maybePreviousBest: Option.some(0.61),
              isPersonalBest: true,
            }),
          }),
          placed({ stars: 1, maybeBestMatch: Option.some(0.824) }),
        ),
      ),
      drawn,
      expect(role('status')).toContainText(
        'A new personal best for this line, up from 61%.',
      ),
      expect(role('status')).toContainText(
        'One star for this line: 75% or more on a guided take.',
      ),
      expect(role('status')).toContainText(
        'Reach 90% on a guided take for two.',
      ),
      expect(role('img', { name: '1 of 3 stars' })).toExist(),
    )
  })

  test('a take that could not be compared says what to try, and that it cost no star', () => {
    scene(
      { update, view },
      given(
        onLine(
          Take.ShowingResult({
            takeNumber: 1,
            mode: 'Blind',
            result: TakeResult.Tracked({
              curve: sampleCurve,
              score: TakeScore.CouldNotCompare({
                version: 1,
                reason: 'TooLittleVoiced',
              }),
              kept: sampleKept,
            }),
            maybeOutcome: Option.some({
              starsBefore: 2,
              starsAfter: 2,
              maybePreviousBest: Option.some(0.92),
              isPersonalBest: false,
            }),
          }),
          placed({ stars: 2, maybeBestMatch: Option.some(0.92) }),
        ),
      ),
      drawn,
      expect(
        role('heading', { name: 'Too little of your take could be compared' }),
      ).toExist(),
      expect(role('status')).toContainText(
        'Try a quieter room, and say every part of the line aloud.',
      ),
      expect(role('status')).toContainText(
        'This line still has 2 of 3 stars: a take that could not be compared costs none.',
      ),
      expect(text(/% match to this clip/)).toBeAbsent(),
    )
  })

  test('offers the next line of the level, or at its last the level itself', () => {
    scene(
      { update, view },
      given(
        onLine(
          Take.Idle(),
          placed(
            noProgress,
            Option.some({ lineId: '2', title: 'Line 2', titleIsText: false }),
          ),
        ),
      ),
      drawn,
      expect(text('Next in 雨が好き')).toExist(),
      expect(role('link', { name: /^Next line: Line 2/ })).toHaveAttr(
        'href',
        '/line/ame-ga-suki/2',
      ),
    )
    scene(
      { update, view },
      given(onLine()),
      drawn,
      expect(text('The last line of 雨が好き you can copy.')).toExist(),
      expect(
        role('link', { name: /^See every line and its stars/ }),
      ).toHaveAttr('href', '/level/ame-ga-suki'),
    )
  })
})
