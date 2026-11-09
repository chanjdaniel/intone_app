import { Match, Option } from 'effect'
import type { Mount } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { swiftF0FrameHz } from '../../engine/pitch/swift-f0'
import { homeRouter, levelRouter, lineHistoryRouter } from '../route'
import { PairLearner, curvePairView, describeCurve } from '../take/curvePair'
import { type TakePanelEvents, takePanel } from '../take/panel'
import {
  type FinishedTake,
  KeptInHistory,
  type Take,
  type TakeCurve,
  type TakeScore,
} from '../take/take'
import { type PracticeLine, lineKey, lineOf } from './lines'
import { type ListenControls, listenControls } from './listenControls'
import type { NativeCurve } from './native'

// A line's practice screen: the line, its curve with the learner's over
// it, listening again at a chosen speed, and the take.

export type PracticeEvents<ViewMessage> = TakePanelEvents<ViewMessage> &
  Pick<ListenControls<ViewMessage>, 'selectSpeed'> &
  Readonly<{
    retryNative: ViewMessage
    draw: (args: {
      native: TakeCurve
      learner: PairLearner
    }) => Mount.MountAction<ViewMessage>
  }>

export type PracticeState = Readonly<{
  native: NativeCurve
  take: Take
  speed: ListenControls<never>['speed']
  canPlayLine: boolean
  canPlayTake: boolean
  maybePlaybackFailure: Option.Option<string>
}>

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

const spanNote =
  "Each curve starts at its voice onset, around its speaker's own typical pitch; the lines are 3 semitones apart, and dashes bridge short pauses."

const alignedNote =
  "Your curve is lined up with the line's by how each part of it sounds, so each part sits over the part of the line it was compared with, around your own typical pitch. The lines are 3 semitones apart."

// The upper canvas for a finished curve and its score, its key made from
// `name`: lined up with the native's when it was scored, else from its
// own onset.
export const scoredLearnerOf = (
  name: string,
  curve: TakeCurve,
  score: TakeScore,
): Readonly<{ key: string; learner: PairLearner; note: string }> => {
  if (score._tag === 'CouldNotCompare') {
    return {
      key: `result-${name}`,
      learner: PairLearner.Finished({ curve }),
      note: spanNote,
    }
  }
  const { nativeFrom, nativeTo } = score.worstStretch
  return {
    key: `aligned-${name}`,
    learner: PairLearner.Aligned({
      f0Hz: score.alignedF0,
      medianHz: describeCurve(curve).medianHz,
      mark: {
        fromFrame: nativeFrom * swiftF0FrameHz,
        toFrame: nativeTo * swiftF0FrameHz,
      },
    }),
    note: alignedNote,
  }
}

// The upper canvas for a finished take; nothing when it has no curve.
const finishedLearnerOf = (
  finished: FinishedTake,
): Option.Option<
  Readonly<{ key: string; learner: PairLearner; note: string }>
> =>
  finished.result._tag === 'Tracked'
    ? Option.some(
        scoredLearnerOf(
          String(finished.takeNumber),
          finished.result.curve,
          finished.result.score,
        ),
      )
    : Option.none()

// What the upper canvas shows for `take`, its key, and the note under it.
export const learnerOf = (
  take: Take,
): Readonly<{ key: string; learner: PairLearner; note: string }> =>
  Match.value(take).pipe(
    Match.tag('Recording', ({ takeNumber, maybeOnsetSeconds }) => ({
      key: `live-${takeNumber}`,
      learner: PairLearner.Live({ takeNumber }),
      note: Option.isNone(maybeOnsetSeconds)
        ? 'Your curve starts when you start to speak, a moment behind your voice.'
        : `Your curve, as you speak. ${spanNote}`,
    })),
    Match.tag('Analysing', ({ takeNumber }) => ({
      key: `live-${takeNumber}`,
      learner: PairLearner.Live({ takeNumber }),
      note: 'Your curve as you said it. Its final shape follows.',
    })),
    Match.orElse(stillTake => {
      const maybeFinished =
        stillTake._tag === 'ShowingResult'
          ? Option.some({
              takeNumber: stillTake.takeNumber,
              result: stillTake.result,
            })
          : stillTake._tag === 'Listening'
            ? stillTake.maybeTake
            : Option.none()
      return Option.match(Option.flatMap(maybeFinished, finishedLearnerOf), {
        onNone: () => ({
          key: 'line',
          learner: PairLearner.None(),
          note: `Press record to draw your curve over the line's. ${spanNote}`,
        }),
        onSome: shown => shown,
      })
    }),
  )

const finishedOf = (take: Take): Option.Option<FinishedTake> =>
  take._tag === 'ShowingResult'
    ? Option.some({ takeNumber: take.takeNumber, result: take.result })
    : take._tag === 'Listening'
      ? take.maybeTake
      : Option.none()

// Under a finished take: that it is kept in the history on this device,
// with the way there, or why it is not.
const keptNote = <ViewMessage>(
  line: PracticeLine,
  take: Take,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  Option.match(
    Option.flatMap(finishedOf(take), ({ result }) =>
      result._tag === 'Tracked' ? Option.some(result.kept) : Option.none(),
    ),
    {
      onNone: () => h.empty,
      onSome: kept =>
        KeptInHistory.match(kept, {
          Kept: ({ maybeAudioFailure }) =>
            h.div(
              [
                h.Class(
                  'flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted',
                ),
              ],
              [
                h.span([], ['Kept in your history on this device.']),
                h.a(
                  [
                    h.Href(
                      lineHistoryRouter({
                        clipId: line.clipId,
                        lineId: line.lineId,
                      }),
                    ),
                    h.Class(
                      `inline-flex min-h-11 items-center rounded-md text-accent underline underline-offset-4 ${focusRing}`,
                    ),
                  ],
                  ['See this line’s history'],
                ),
                ...Option.match(maybeAudioFailure, {
                  onNone: () => [],
                  onSome: reason => [
                    h.span(
                      [h.Class('basis-full text-bad break-words')],
                      [`Its recording was not kept: ${reason}`],
                    ),
                  ],
                }),
              ],
            ),
          NotKept: ({ reason }) =>
            h.p(
              [h.Class('text-sm text-bad break-words')],
              [`This take was not kept in your history: ${reason}`],
            ),
        }),
    },
  )

const playingOf = (take: Take): ListenControls<never>['playing'] =>
  take._tag === 'Listening' && take.extent === 'Whole' ? take.voice : 'Nothing'

const nativeBox = 'h-56 w-full rounded-md border border-line bg-raised sm:h-64'

const nativePending = <ViewMessage>(
  native: NativeCurve,
  events: PracticeEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  native._tag === 'Failed'
    ? h.div(
        [
          h.Class(
            `${nativeBox} flex flex-col items-start justify-center gap-4 p-5`,
          ),
        ],
        [
          h.p(
            [h.Role('alert'), h.Class('text-base text-ink break-words')],
            [`The line's pitch could not be found. ${native.reason}`],
          ),
          h.button(
            [
              h.Type('button'),
              h.OnClick(events.retryNative),
              h.Class(
                `inline-flex min-h-11 items-center rounded-md bg-accent px-5 text-base font-semibold text-on-accent ${focusRing}`,
              ),
            ],
            ['Try again'],
          ),
        ],
      )
    : h.div(
        [h.Class(`${nativeBox} flex items-center justify-center p-5`)],
        [
          h.p(
            [h.Role('status'), h.Class('text-base text-muted text-center')],
            [
              "Finding the line's pitch. This takes a moment the first time, then the device remembers it.",
            ],
          ),
        ],
      )

// Where the back link goes: a bundled line's to every line, a line of
// the learner's clip to the clip's lines.
const backOf = (clipId: string, lineId: string) =>
  Option.isSome(lineOf(clipId, lineId))
    ? { href: homeRouter(), text: 'All lines' }
    : {
        href: levelRouter({ clipId, maybeFind: Option.none() }),
        text: 'This clip’s lines',
      }

// The screen's heading: the line, once it is known. A bundled line is
// known at once; a line of the learner's clip once it is read.
const lineHeader = <ViewMessage>(
  maybeLine: Option.Option<PracticeLine>,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  Option.match(maybeLine, {
    onNone: () =>
      h.header(
        [h.Class('flex flex-col gap-1')],
        [
          h.h1(
            [h.Class('text-3xl font-bold sm:text-5xl')],
            ['A line of your clip'],
          ),
        ],
      ),
    onSome: line =>
      h.header(
        [h.Class('flex flex-col gap-1')],
        [
          h.h1(
            [
              ...(line.titleIsText ? [h.Lang('ja')] : []),
              h.Class('text-3xl font-bold sm:text-5xl break-words'),
            ],
            [line.title],
          ),
          h.p(
            [
              ...(line.titleIsText ? [h.Lang('ja')] : []),
              h.Class('text-lg text-muted break-words'),
            ],
            [line.detail],
          ),
        ],
      ),
  })

export const practiceView = <ViewMessage>(
  clipId: string,
  lineId: string,
  maybeLine: Option.Option<PracticeLine>,
  state: PracticeState,
  events: PracticeEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html => {
  const native = state.native
  const back = backOf(clipId, lineId)
  return h.main(
    [h.Class('min-h-screen bg-surface text-ink px-4 py-6 sm:px-6 sm:py-10')],
    [
      h.div(
        [h.Class('mx-auto flex max-w-2xl flex-col gap-6')],
        [
          h.nav(
            [h.AriaLabel('Back')],
            [
              h.a(
                [
                  h.Href(back.href),
                  h.Class(
                    `inline-flex min-h-11 items-center gap-1.5 rounded-md text-accent ${focusRing}`,
                  ),
                ],
                [
                  h.span([h.AriaHidden(true)], ['←']),
                  h.span(
                    [h.Class('underline underline-offset-4')],
                    [back.text],
                  ),
                ],
              ),
            ],
          ),
          lineHeader(maybeLine, h),
          native._tag === 'Ready'
            ? readyBody(native.line, native.curve, state, events, h)
            : nativePending(native, events, h),
          Option.match(maybeLine, {
            onNone: () => h.empty,
            onSome: line =>
              h.footer([h.Class('text-sm text-muted')], [line.credit]),
          }),
        ],
      ),
    ],
  )
}

const readyBody = <ViewMessage>(
  line: PracticeLine,
  nativeCurve: TakeCurve,
  state: PracticeState,
  events: PracticeEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html => {
  const { key, learner, note } = learnerOf(state.take)
  return h.div(
    [h.Class('flex flex-col gap-6')],
    [
      curvePairView(
        `${lineKey(line)}:${key}`,
        nativeCurve,
        learner,
        note,
        events.draw,
        h,
      ),
      takePanel(state.take, events, h),
      keptNote(line, state.take, h),
      h.section(
        [h.AriaLabelledBy('listen-heading'), h.Class('flex flex-col gap-3')],
        [
          h.h2(
            [h.Id('listen-heading'), h.Class('text-lg font-bold')],
            ['Listen again'],
          ),
          listenControls(
            {
              playing: playingOf(state.take),
              canPlayLine: state.canPlayLine,
              canPlayTake: state.canPlayTake,
              speed: state.speed,
              listen: voice => events.listen(voice, 'Whole'),
              stop: events.stopListening,
              selectSpeed: events.selectSpeed,
            },
            h,
          ),
          Option.match(state.maybePlaybackFailure, {
            onNone: () => h.empty,
            onSome: reason =>
              h.p(
                [h.Role('alert'), h.Class('text-sm text-bad break-words')],
                [`That did not play: ${reason}`],
              ),
          }),
        ],
      ),
    ],
  )
}
