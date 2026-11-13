import { Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { outcomeSummary } from '../level/outcomeView'
import type { TakeOutcome } from '../level/progress'
import { takeFocusAttribute } from './commands'
import { levelMeter } from './levelMeter'
import { couldNotCompareText, scoreSummary, worstStretch } from './scoreCard'
import {
  type Extent,
  type FinishedTake,
  Take,
  type TakeMode,
  type Voice,
  longestTakeSeconds,
} from './take'

// The mic state panel: one clear screen for every state of a take, from
// the record buttons through playing the line, asking for the microphone,
// recording and analysing, to the result or the reason there is none.
// Each state offers one thing to do next, and before or after a take a
// blind take beside it; that first control (or the heading, when there
// is none) carries `takeFocusAttribute`, so focus follows the take.
// Listening again shows the screen it was started from. The curves
// themselves are drawn above the panel (./curvePair.ts); a blind take
// hides them, and the level meter, until it ends, and its result shows
// everything, with what it did for the line's stars.
//
// What a state says goes in one live region, which stays in place from
// state to state, so a screen reader hears each change once: the take's
// score among them, when it comes, and not again while its voices play.

export type TakePanelEvents<ViewMessage> = Readonly<{
  record: ViewMessage
  recordBlind: ViewMessage
  stop: ViewMessage
  cancel: ViewMessage
  // A scored take's worst stretch, in either voice.
  listen: (voice: Voice, extent: Extent) => ViewMessage
  stopListening: ViewMessage
}>

const primaryButton = 'button-primary'
const secondaryButton = 'button-secondary'

export const headingId = 'take-heading'

const formatClock = (seconds: number): string => {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

type Tone = 'neutral' | 'busy' | 'live' | 'problem'

type Screen<ViewMessage> = Readonly<{
  tone: Tone
  heading: string
  lines: ReadonlyArray<string>
  // Said in the live region after the lines.
  summary?: Html
  // Shown after the live region, out of it.
  body?: Html
  action?: Action<ViewMessage>
  // Beside the action, never focused by the take.
  secondary?: Action<ViewMessage>
}>

type Action<ViewMessage> = Readonly<{
  label: string
  message: ViewMessage
  kind: 'primary' | 'secondary'
}>

const blindLine =
  'This take is blind: the curves and the level stay hidden until you stop, then you see everything.'

// What a state of a take under way says, with a blind take's note.
const linesFor = (
  mode: TakeMode,
  lines: ReadonlyArray<string>,
): ReadonlyArray<string> => (mode === 'Blind' ? [...lines, blindLine] : lines)

const toneMark: Readonly<Record<Tone, string>> = {
  neutral: 'bg-line',
  busy: 'bg-accent motion-safe:animate-pulse',
  live: 'bg-bad motion-safe:animate-pulse',
  problem: 'bg-warn',
}

const screenOf = <ViewMessage>(
  take: Take,
  events: TakePanelEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Screen<ViewMessage> =>
  Take.match<Screen<ViewMessage>>(take, {
    Idle: () => idleScreen(events),
    PlayingNative: ({ mode }) => ({
      tone: 'busy',
      heading: 'Listen to the line',
      lines: linesFor(mode, [
        'The microphone opens when the line ends. Then say it back.',
      ]),
      action: { label: 'Cancel', message: events.cancel, kind: 'secondary' },
    }),
    Preparing: ({ mode }) => ({
      tone: 'busy',
      heading: 'Getting ready',
      lines: linesFor(mode, [
        'Loading the pitch tracker. This takes a moment the first time.',
      ]),
      action: { label: 'Cancel', message: events.cancel, kind: 'secondary' },
    }),
    AwaitingMic: ({ mode }) => ({
      tone: 'busy',
      heading: 'Allow the microphone',
      lines: linesFor(mode, [
        'Your browser is asking to use the microphone. Choose Allow to start the take.',
      ]),
      action: { label: 'Cancel', message: events.cancel, kind: 'secondary' },
    }),
    MicPromptIgnored: ({ mode }) => ({
      tone: 'problem',
      heading: 'Still waiting for the microphone',
      lines: linesFor(mode, [
        "The browser's prompt is usually next to the address bar. Choose Allow there.",
        'If you closed it, open the site settings from the icon left of the address and allow the microphone.',
      ]),
      action: { label: 'Cancel', message: events.cancel, kind: 'secondary' },
    }),
    Recording: ({ mode, elapsedSeconds, levelDb }) =>
      mode === 'Blind'
        ? {
            tone: 'live',
            heading: 'Recording blind',
            lines: [
              'Say the line from memory, then press stop. The curves and the level are hidden until then.',
            ],
            body: recordingBody(elapsedSeconds, Option.none(), h),
            action: { label: 'Stop', message: events.stop, kind: 'primary' },
          }
        : {
            tone: 'live',
            heading: 'Recording',
            lines: ['Say the line, then press stop.'],
            body: recordingBody(elapsedSeconds, Option.some(levelDb), h),
            action: { label: 'Stop', message: events.stop, kind: 'primary' },
          },
    Analysing: ({ mode }) => ({
      tone: 'busy',
      heading: 'Finding your pitch',
      lines:
        mode === 'Blind'
          ? [
              'The microphone is off. Tracking your take now; then you see everything.',
            ]
          : ['The microphone is off. Tracking your take now.'],
    }),
    ShowingResult: finished => resultScreen(finished, 'Nothing', events, h),
    Listening: ({ voice, extent, maybeTake }) =>
      Option.match(maybeTake, {
        onNone: () => idleScreen(events),
        onSome: finished =>
          resultScreen(
            finished,
            extent === 'WorstStretch' ? voice : 'Nothing',
            events,
            h,
          ),
      }),
    MicDenied: () => ({
      tone: 'problem',
      heading: 'The microphone is blocked',
      lines: [
        'Intone needs the microphone to hear your take, and the browser has said no.',
        'To allow it, open the site settings from the icon left of the address, set Microphone to Allow, then try again.',
      ],
      action: { label: 'Try again', message: events.record, kind: 'primary' },
    }),
    NoMicDevice: () => ({
      tone: 'problem',
      heading: 'No microphone found',
      lines: ['Connect a microphone or a headset with one, then try again.'],
      action: { label: 'Try again', message: events.record, kind: 'primary' },
    }),
    MicFailed: ({ reason }) => ({
      tone: 'problem',
      heading: 'The microphone did not start',
      lines: [
        'Another app may be using it. Close it, or choose another microphone, then try again.',
        `The browser said: ${reason}`,
      ],
      action: { label: 'Try again', message: events.record, kind: 'primary' },
    }),
    AnalysisFailed: ({ reason }) => ({
      tone: 'problem',
      heading: 'Your take could not be tracked',
      lines: ['Something went wrong while finding your pitch.', reason],
      action: { label: 'Try again', message: events.record, kind: 'primary' },
    }),
  })

const idleScreen = <ViewMessage>(
  events: TakePanelEvents<ViewMessage>,
): Screen<ViewMessage> => ({
  tone: 'neutral',
  heading: 'Copy the line',
  lines: [
    'Press record: the line plays once, then the microphone opens for you to say it back. Press stop when you are done.',
    'Record blind to say it with the curves hidden until you stop.',
  ],
  action: { label: 'Record', message: events.record, kind: 'primary' },
  secondary: blindAction(events),
})

const blindAction = <ViewMessage>(
  events: TakePanelEvents<ViewMessage>,
): Action<ViewMessage> => ({
  label: 'Record blind',
  message: events.recordBlind,
  kind: 'secondary',
})

// The clock and the level meter, while the microphone is on; the clock
// alone during a blind take.
const recordingBody = <ViewMessage>(
  elapsedSeconds: number,
  maybeLevelDb: Option.Option<number>,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.div(
    [
      h.Class(
        'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6',
      ),
    ],
    [
      h.p(
        [
          h.Role('timer'),
          h.Class('shrink-0 text-base font-semibold tabular-nums'),
        ],
        [
          `${formatClock(elapsedSeconds)} of ${formatClock(longestTakeSeconds)}`,
        ],
      ),
      ...Option.match(maybeLevelDb, {
        onNone: () => [],
        onSome: levelDb => [
          h.div([h.Class('w-full sm:max-w-xs')], [levelMeter(levelDb, h)]),
        ],
      }),
    ],
  )

// What a kept take did for its line, said with its score.
const outcomeOf = <ViewMessage>(
  maybeOutcome: Option.Option<TakeOutcome>,
  compared: boolean,
  h: HtmlBuilder<ViewMessage>,
): ReadonlyArray<Html> =>
  Option.match(maybeOutcome, {
    onNone: () => [],
    onSome: outcome => [outcomeSummary(outcome, compared, h)],
  })

// A finished take: its score, or why it has none, and what it did for
// its line's stars. `stretchPlaying` is the voice whose worst stretch
// plays now, if either.
const resultScreen = <ViewMessage>(
  finished: FinishedTake,
  stretchPlaying: Voice | 'Nothing',
  events: TakePanelEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Screen<ViewMessage> => {
  const { result, mode, maybeOutcome } = finished
  const again: Screen<ViewMessage>['action'] = {
    label: 'Record again',
    message: events.record,
    kind: 'primary',
  }
  const secondary = blindAction(events)
  if (result._tag === 'Tracked') {
    const score = result.score
    if (score._tag === 'CouldNotCompare') {
      const { heading, lines } = couldNotCompareText[score.reason]
      return {
        tone: 'problem',
        heading,
        lines,
        summary: h.div(
          [h.Class('flex flex-col gap-4 empty:hidden')],
          outcomeOf(maybeOutcome, false, h),
        ),
        action: again,
        secondary,
      }
    }
    return {
      tone: 'neutral',
      heading: mode === 'Blind' ? 'Your copy, blind' : 'Your copy',
      lines: [],
      summary: h.div(
        [h.Class('flex flex-col gap-4')],
        [scoreSummary(score, h), ...outcomeOf(maybeOutcome, true, h)],
      ),
      body: worstStretch(
        score,
        {
          playing: stretchPlaying,
          hear: voice => events.listen(voice, 'WorstStretch'),
          stop: events.stopListening,
        },
        h,
      ),
      action: again,
      secondary,
    }
  }
  return result._tag === 'TooQuiet'
    ? {
        tone: 'problem',
        heading: 'That take was too quiet to track',
        lines: [
          'The microphone hardly heard you. Move closer to it or speak up, then record again.',
        ],
        action: again,
        secondary,
      }
    : {
        tone: 'problem',
        heading: 'That take was too noisy to track',
        lines: [
          'There was more sound around you than voice. Try somewhere quieter, or closer to the microphone.',
        ],
        action: again,
        secondary,
      }
}

export const takePanel = <ViewMessage>(
  take: Take,
  events: TakePanelEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html => {
  const screen = screenOf(take, events, h)
  const action = screen.action
  const secondary = screen.secondary
  return h.section(
    [
      h.AriaLabelledBy(headingId),
      h.Class(
        'flex flex-col gap-5 rounded-lg border border-line bg-raised p-5 text-left sm:p-6',
      ),
    ],
    [
      h.div(
        [h.Class('flex items-start gap-3')],
        [
          h.span([
            h.AriaHidden(true),
            h.Class(
              `mt-2 size-3 shrink-0 rounded-full ${toneMark[screen.tone]}`,
            ),
          ]),
          h.h2(
            [
              h.Id(headingId),
              ...(action === undefined
                ? [h.DataAttribute(takeFocusAttribute, ''), h.Tabindex(-1)]
                : []),
              h.Class('text-xl font-bold outline-none'),
            ],
            [screen.heading],
          ),
        ],
      ),
      h.div(
        [h.Role('status'), h.Class('flex flex-col gap-2 empty:hidden')],
        [
          ...screen.lines.map(line =>
            h.p([h.Class('text-base text-muted break-words')], [line]),
          ),
          ...(screen.summary === undefined ? [] : [screen.summary]),
        ],
      ),
      ...(screen.body === undefined ? [] : [screen.body]),
      ...(action === undefined
        ? []
        : [
            h.div(
              [h.Class('flex flex-wrap gap-3')],
              [
                h.button(
                  [
                    h.DataAttribute(takeFocusAttribute, ''),
                    h.Type('button'),
                    h.OnClick(action.message),
                    h.Class(
                      action.kind === 'primary'
                        ? primaryButton
                        : secondaryButton,
                    ),
                  ],
                  [action.label],
                ),
                ...(secondary === undefined
                  ? []
                  : [
                      h.button(
                        [
                          h.Type('button'),
                          h.OnClick(secondary.message),
                          h.Class(secondaryButton),
                        ],
                        [secondary.label],
                      ),
                    ]),
              ],
            ),
          ]),
    ],
  )
}
