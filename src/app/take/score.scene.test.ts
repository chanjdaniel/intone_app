import { Option } from 'effect'
import {
  Mount,
  click,
  expect,
  given,
  inside,
  role,
  scene,
  text,
} from 'foldkit/scene'
import { describe, test } from 'vitest'

import { NativeCurve } from '../line/native'
import {
  AppRoute,
  Message,
  type Model,
  initialModel,
  update,
  view,
} from '../main'
import { DrawCurvePair } from './curvePair'
import { provisionalText } from './scoreCard'
import { KeptInHistory, Take, TakeResult, TakeScore } from './take'
import {
  sampleCurve,
  sampleFeatures,
  sampleKept,
  sampleLine,
  sampleScore,
} from './testCurves'

// The score card on the practice screen, after a take.

const showing = (score: TakeScore): Model => ({
  ...initialModel(AppRoute.Line({ clipId: 'ame-ga-suki', lineId: '1' })),
  native: NativeCurve.Ready({
    clipId: 'ame-ga-suki',
    lineId: '1',
    line: sampleLine,
    curve: sampleCurve,
    features: sampleFeatures,
  }),
  take: Take.ShowingResult({
    mode: 'Guided',
    maybeOutcome: Option.none(),
    takeNumber: 1,
    result: TakeResult.Tracked({ curve: sampleCurve, score, kept: sampleKept }),
  }),
  takesStarted: 1,
})

const drawn = Mount.resolve(DrawCurvePair, Message.CompletedDrawCurvePair())

const announced = role('status')
// The live region's text content, its blocks run together.
const summaryText =
  "82% match to this clipPitch accent76%Timing93%Your take's pitch accent and timing, compared with this one recording, with your own voice's pitch and speed taken out."

describe('the score card', () => {
  test('shows the match, each part by name, and that the scale is provisional', () => {
    scene(
      { update, view },
      given(showing(sampleScore)),
      drawn,
      expect(role('heading', { name: 'Your copy' })).toExist(),
      expect(announced).toHaveText(`${summaryText}${provisionalText}`),
      inside(
        role('list', { name: 'Parts of the match' }),
        expect(text('Pitch accent')).toExist(),
        expect(text('76%')).toExist(),
        expect(text('Timing')).toExist(),
        expect(text('93%')).toExist(),
      ),
      expect(role('button', { name: 'Record again' })).toExist(),
    )
  })

  test('says nothing of a provisional scale once it is settled', () => {
    scene(
      { update, view },
      given(showing({ ...sampleScore, provisional: false })),
      drawn,
      expect(announced).toHaveText(summaryText),
      expect(text(provisionalText)).toBeAbsent(),
    )
  })

  test('draws the take lined up with the line, its worst stretch shaded on both', () => {
    scene(
      { update, view },
      given(showing(sampleScore)),
      drawn,
      expect(
        role('img', {
          name: /^Your pitch curve, lined up with the line's where the two were compared, .* The stretch where it differed most is shaded\.$/,
        }),
      ).toExist(),
      expect(text('Where it differed most', { exact: true })).toExist(),
      expect(
        text(
          'From 0.03 s to 0.06 s of the line, shaded on the curves. Hear both voices there.',
        ),
      ).toExist(),
    )
  })

  test('plays the worst stretch from each voice, and says it once', () => {
    scene(
      { update, view },
      given(showing(sampleScore)),
      drawn,
      click(role('button', { name: 'Hear the line there' })),
      expect(role('button', { name: 'Stop' })).toExist(),
      expect(role('button', { name: 'Hear your take there' })).toExist(),
      // The live region is as it was: the score is not said again.
      expect(announced).toHaveText(`${summaryText}${provisionalText}`),
      click(role('button', { name: 'Hear your take there' })),
      expect(role('button', { name: 'Hear the line there' })).toExist(),
      click(role('button', { name: 'Stop' })),
      expect(role('button', { name: 'Stop' })).toBeAbsent(),
      expect(announced).toHaveText(`${summaryText}${provisionalText}`),
    )
  })

  test.each([
    [
      'TooQuiet',
      'Your take was too quiet to compare',
      'Speak closer to the microphone, or a little louder, then record again.',
    ],
    [
      'TooLittleVoiced',
      'Too little of your take could be compared',
      'Try a quieter room, and say every part of the line aloud.',
    ],
    [
      'LengthMismatch',
      "Your take was too far from the line's length to compare",
      'Say the whole line, once, at about its own pace.',
    ],
  ] as const)(
    'says what to try when it could not compare (%s), and gives no number',
    (reason, heading, advice) => {
      scene(
        { update, view },
        given(showing(TakeScore.CouldNotCompare({ version: 1, reason }))),
        drawn,
        expect(role('heading', { name: heading })).toExist(),
        expect(announced).toContainText(advice),
        expect(text(/%/)).toBeAbsent(),
        expect(role('button', { name: 'Hear the line there' })).toBeAbsent(),
        expect(role('button', { name: 'Record again' })).toExist(),
        // The take is drawn from its own onset, not lined up.
        expect(
          role('img', {
            name: /^Your pitch curve, 0\.\d\d s from your voice onset/,
          }),
        ).toExist(),
      )
    },
  )
})

describe('the take in the history', () => {
  const showingKept = (kept: KeptInHistory): Model => ({
    ...showing(sampleScore),
    take: Take.ShowingResult({
      mode: 'Guided',
      maybeOutcome: Option.none(),
      takeNumber: 1,
      result: TakeResult.Tracked({
        curve: sampleCurve,
        score: sampleScore,
        kept,
      }),
    }),
  })

  test('says a kept take is kept on this device, with the way to the line’s history', () => {
    scene(
      { update, view },
      given(showingKept(sampleKept)),
      drawn,
      expect(text('Kept in your history on this device.')).toExist(),
      expect(role('link', { name: 'See this line’s history' })).toHaveAttr(
        'href',
        '/history/ame-ga-suki/1',
      ),
      expect(text(/recording was not kept/)).toBeAbsent(),
    )
  })

  test('says why the recording, or the whole take, was not kept', () => {
    scene(
      { update, view },
      given(
        showingKept(
          KeptInHistory.Kept({
            id: 'a',
            day: '2026-11-10',
            maybeAudioFailure: Option.some('The disk is full.'),
          }),
        ),
      ),
      drawn,
      expect(text('Its recording was not kept: The disk is full.')).toExist(),
    )
    scene(
      { update, view },
      given(
        showingKept(KeptInHistory.NotKept({ reason: 'The history was full.' })),
      ),
      drawn,
      expect(
        text('This take was not kept in your history: The history was full.'),
      ).toExist(),
      expect(role('link', { name: 'See this line’s history' })).toBeAbsent(),
    )
  })
})
