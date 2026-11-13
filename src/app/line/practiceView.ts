import { Match, Option } from 'effect'
import type { Mount } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { swiftF0FrameHz } from '../../engine/pitch/swift-f0'
import { dayText } from '../history/format'
import { starRow, starRules } from '../level/starRow'
import { screenFrame } from '../pageFrame'
import {
  type ReadingsEvents,
  type ReadingsState,
  readingsControls,
  rubyText,
  shownWords,
} from '../readings/readingsView'
import { isReturnDue } from '../returns/lineReturn'
import { levelRouter, lineHistoryRouter, lineRouter } from '../route'
import { PairLearner, curvePairView, describeCurve } from '../take/curvePair'
import { type TakePanelEvents, takePanel } from '../take/panel'
import {
  type FinishedTake,
  KeptInHistory,
  type Take,
  type TakeCurve,
  type TakeScore,
  isBlindUnderWay,
} from '../take/take'
import { type PracticeLine, lineKey } from './lines'
import { type ListenControls, listenControls } from './listenControls'
import type { NativeCurve } from './native'
import { LinePlace } from './place'
import { sourceLink } from './sourceLink'

// A line's practice screen: the line and its stars, its curve with the
// learner's over it (both hidden during a blind take), listening again
// at a chosen speed, the take, and the next line of its level. The loop
// it runs (report section 5): hear the line, a guided take, the curves
// overlaid with the match, again as often as wanted, a blind take, and on
// to the next line.

export type PracticeEvents<ViewMessage> = TakePanelEvents<ViewMessage> &
  Pick<ListenControls<ViewMessage>, 'selectSpeed'> &
  Readonly<{
    retryNative: ViewMessage
    readings: ReadingsEvents<ViewMessage>
    draw: (args: {
      native: TakeCurve
      learner: PairLearner
    }) => Mount.MountAction<ViewMessage>
  }>

export type PracticeState = Readonly<{
  native: NativeCurve
  place: LinePlace
  take: Take
  speed: ListenControls<never>['speed']
  canPlayLine: boolean
  canPlayTake: boolean
  maybePlaybackFailure: Option.Option<string>
  readings: ReadingsState
}>

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

const finishedOf = (take: Take): Option.Option<FinishedTake> =>
  take._tag === 'ShowingResult'
    ? Option.some({
        takeNumber: take.takeNumber,
        mode: take.mode,
        result: take.result,
        maybeOutcome: take.maybeOutcome,
      })
    : take._tag === 'Listening'
      ? take.maybeTake
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
      return Option.match(
        Option.flatMap(finishedOf(stillTake), finishedLearnerOf),
        {
          onNone: () => ({
            key: 'line',
            learner: PairLearner.None(),
            note: `Press record to draw your curve over the line's. ${spanNote}`,
          }),
          onSome: shown => shown,
        },
      )
    }),
  )

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
                      `inline-flex min-h-11 items-center rounded-md text-accent underline underline-offset-4 focus-ring`,
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
              h.Class('button-primary'),
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

// The back link goes to the line's level, where every line of its clip
// is, with its stars.
const backOf = (clipId: string) => ({
  href: levelRouter({ clipId, maybeFind: Option.none() }),
  text: 'This clip’s lines',
})

// During a blind take, in the curves' place and at their size: why
// they are not there.
const blindCover = <ViewMessage>(h: HtmlBuilder<ViewMessage>): Html =>
  h.figure(
    [h.DataAttribute('blind-cover', ''), h.Class('flex flex-col gap-3')],
    [
      h.div(
        [
          h.Class(
            'flex h-56 w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-line bg-raised p-6 text-center sm:h-64',
          ),
        ],
        [
          h.p([h.Class('text-xl font-bold text-ink')], ['A blind take']),
          h.p(
            [h.Class('max-w-sm text-base text-muted')],
            [
              'The curves are hidden while you speak, so you copy the line by ear.',
            ],
          ),
        ],
      ),
      h.figcaption(
        [h.Class('text-sm text-muted')],
        [
          'They come back with your match, yours lined up over the line’s, when you stop.',
        ],
      ),
    ],
  )

// Under the heading: the line's stars, its best, and how stars are
// earned, once its place in its level is read.
// When the line comes back for a blind take, once it has had one.
export const returnText = (
  place: Extract<LinePlace, { _tag: 'Ready' }>,
): Option.Option<string> =>
  Option.map(place.maybeReturn, ({ dueOn }) =>
    isReturnDue(place.maybeReturn, place.today)
      ? 'Due back today: record it blind, as only a blind take counts as its return.'
      : `Comes back for a blind take on ${dayText(dueOn)}.`,
  )

const linePlaceView = <ViewMessage>(
  place: LinePlace,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  place._tag === 'Ready'
    ? h.section(
        [
          h.AriaLabel('This line’s stars'),
          h.DataAttribute('line-stars', ''),
          h.Class(
            'flex flex-col gap-3 rounded-lg border border-line bg-raised p-4',
          ),
        ],
        [
          h.div(
            [
              h.Class(
                'flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-5',
              ),
            ],
            [
              h.div(
                [h.Class('flex items-center gap-3')],
                [
                  starRow(place.progress.stars, h, { size: 'large' }),
                  ...Option.match(place.progress.maybeBestMatch, {
                    onNone: () => [],
                    onSome: best => [
                      h.p(
                        [
                          h.Class(
                            'text-base font-semibold tabular-nums text-ink',
                          ),
                        ],
                        [`Best ${Math.round(100 * best)}%`],
                      ),
                    ],
                  }),
                ],
              ),
              h.ul(
                [h.Class('flex flex-col text-sm text-muted')],
                starRules().map(rule => h.li([], [rule])),
              ),
            ],
          ),
          ...Option.match(returnText(place), {
            onNone: () => [],
            onSome: text => [
              h.p(
                [
                  h.DataAttribute('line-return', ''),
                  h.Class(
                    'border-t border-line pt-3 text-base text-ink break-words',
                  ),
                ],
                [text],
              ),
            ],
          }),
        ],
      )
    : h.empty

// After the take: on to the next line of the level, or, at its last
// line, back to the level.
const nextView = <ViewMessage>(
  place: LinePlace,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  place._tag === 'Ready'
    ? h.nav(
        [
          h.AriaLabel('Next'),
          h.Class('flex flex-col gap-1 border-t border-line pt-5'),
        ],
        Option.match(place.maybeNext, {
          onSome: next => [
            h.p(
              [h.Class('text-sm text-muted')],
              [`Next in ${place.levelName}`],
            ),
            h.a(
              [
                h.Href(
                  lineRouter({ clipId: place.clipId, lineId: next.lineId }),
                ),
                h.Class(
                  `inline-flex min-h-11 items-center gap-1.5 self-start rounded-md text-lg font-semibold text-accent focus-ring`,
                ),
              ],
              [
                h.span(
                  [h.Class('underline underline-offset-4')],
                  [
                    'Next line: ',
                    h.span(next.titleIsText ? [h.Lang('ja')] : [], [
                      next.title,
                    ]),
                  ],
                ),
                h.span([h.AriaHidden(true)], ['→']),
              ],
            ),
          ],
          onNone: () => [
            h.p(
              [h.Class('text-sm text-muted')],
              [`The last line of ${place.levelName} you can copy.`],
            ),
            h.a(
              [
                h.Href(
                  levelRouter({
                    clipId: place.clipId,
                    maybeFind: Option.none(),
                  }),
                ),
                h.Class(
                  `inline-flex min-h-11 items-center gap-1.5 self-start rounded-md text-lg font-semibold text-accent focus-ring`,
                ),
              ],
              [
                h.span(
                  [h.Class('underline underline-offset-4')],
                  ['See every line and its stars'],
                ),
                h.span([h.AriaHidden(true)], ['→']),
              ],
            ),
          ],
        }),
      )
    : h.empty

// The screen's heading: the line, once it is known, its kanji with their
// readings over them when the learner shows them, and the readings'
// controls under a line with Japanese text. A bundled line is known at
// once; a line of the learner's clip once it is read.
const lineHeader = <ViewMessage>(
  maybeLine: Option.Option<PracticeLine>,
  readings: ReadingsState,
  events: ReadingsEvents<ViewMessage>,
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
    onSome: line => {
      const maybeWords = line.titleIsText
        ? shownWords(readings, line.title)
        : Option.none()
      return h.header(
        [h.Class('flex flex-col gap-1')],
        [
          h.h1(
            [
              ...(line.titleIsText ? [h.Lang('ja')] : []),
              h.Class(
                `text-3xl font-bold sm:text-5xl break-words ${Option.isSome(maybeWords) ? 'leading-[1.75] sm:leading-[1.6]' : ''}`,
              ),
            ],
            Option.match(maybeWords, {
              onNone: () => [line.title],
              onSome: words => rubyText(words, h),
            }),
          ),
          h.p(
            [
              ...(line.detailIsText ? [h.Lang('ja')] : []),
              h.Class('text-lg text-muted break-words'),
            ],
            [line.detail],
          ),
          line.titleIsText
            ? h.div(
                [h.Class('mt-3')],
                [readingsControls(readings, line.title, events, h)],
              )
            : h.empty,
        ],
      )
    },
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
  const back = backOf(clipId)
  return screenFrame(
    'gap-6',
    [
      h.nav(
        [h.AriaLabel('Back')],
        [
          h.a(
            [
              h.Href(back.href),
              h.Class(
                `inline-flex min-h-11 items-center gap-1.5 rounded-md text-accent focus-ring`,
              ),
            ],
            [
              h.span([h.AriaHidden(true)], ['←']),
              h.span([h.Class('underline underline-offset-4')], [back.text]),
            ],
          ),
        ],
      ),
      lineHeader(maybeLine, state.readings, events.readings, h),
      linePlaceView(state.place, h),
      native._tag === 'Ready'
        ? readyBody(native.line, native.curve, state, events, h)
        : nativePending(native, events, h),
      nextView(state.place, h),
      Option.match(maybeLine, {
        onNone: () => h.empty,
        onSome: line =>
          h.footer(
            [h.Class('flex flex-col gap-1 text-sm text-muted')],
            [
              h.p([], [line.credit]),
              ...Option.match(line.maybeSource, {
                onNone: () => [],
                onSome: source => [sourceLink(source, h)],
              }),
            ],
          ),
      }),
    ],
    h,
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
      isBlindUnderWay(state.take)
        ? blindCover(h)
        : curvePairView(
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
