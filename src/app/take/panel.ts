import type { Mount } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { takeFocusAttribute } from './commands'
import { curveView } from './curveView'
import {
  Take,
  type TakeCurve,
  type TakeResult,
  longestTakeSeconds,
} from './take'

// The mic state panel: one clear screen for every state of a take, from
// the record button through asking for the microphone, recording and
// analysing, to the curve or the reason there is none. Each state offers
// at most one thing to do next, and that control (or the heading, when
// there is none) carries `takeFocusAttribute`, so focus follows the take.

export type TakePanelEvents<ViewMessage> = Readonly<{
  record: ViewMessage
  stop: ViewMessage
  cancel: ViewMessage
  paint: (args: { curve: TakeCurve }) => Mount.MountAction<ViewMessage>
}>

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

const buttonBase = `inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-5 text-base font-semibold ${focusRing}`

const primaryButton = `${buttonBase} bg-accent text-on-accent`
const secondaryButton = `${buttonBase} border border-line bg-surface text-ink`

export const headingId = 'take-heading'

export const formatClock = (seconds: number): string => {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

type Tone = 'neutral' | 'busy' | 'live' | 'problem'

type Screen<ViewMessage> = Readonly<{
  tone: Tone
  heading: string
  lines: ReadonlyArray<string>
  body?: Html
  action?: Readonly<{
    label: string
    message: ViewMessage
    kind: 'primary' | 'secondary'
  }>
}>

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
    Idle: () => ({
      tone: 'neutral',
      heading: 'Record a take',
      lines: ['Press record, say a line, then press stop to see your pitch.'],
      action: { label: 'Record', message: events.record, kind: 'primary' },
    }),
    Preparing: () => ({
      tone: 'busy',
      heading: 'Getting ready',
      lines: ['Loading the pitch tracker. This takes a moment the first time.'],
      action: { label: 'Cancel', message: events.cancel, kind: 'secondary' },
    }),
    AwaitingMic: () => ({
      tone: 'busy',
      heading: 'Allow the microphone',
      lines: [
        'Your browser is asking to use the microphone. Choose Allow to start the take.',
      ],
      action: { label: 'Cancel', message: events.cancel, kind: 'secondary' },
    }),
    MicPromptIgnored: () => ({
      tone: 'problem',
      heading: 'Still waiting for the microphone',
      lines: [
        "The browser's prompt is usually next to the address bar. Choose Allow there.",
        'If you closed it, open the site settings from the icon left of the address and allow the microphone.',
      ],
      action: { label: 'Cancel', message: events.cancel, kind: 'secondary' },
    }),
    Recording: ({ elapsedSeconds }) => ({
      tone: 'live',
      heading: 'Recording',
      lines: [
        `${formatClock(elapsedSeconds)} of ${formatClock(longestTakeSeconds)}. Say your line, then press stop.`,
      ],
      action: { label: 'Stop', message: events.stop, kind: 'primary' },
    }),
    Analysing: () => ({
      tone: 'busy',
      heading: 'Finding your pitch',
      lines: ['The microphone is off. Tracking your take now.'],
    }),
    ShowingResult: ({ takeNumber, result }) =>
      resultScreen(takeNumber, result, events, h),
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

const resultScreen = <ViewMessage>(
  takeNumber: number,
  result: TakeResult,
  events: TakePanelEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Screen<ViewMessage> => {
  const again: Screen<ViewMessage>['action'] = {
    label: 'Record again',
    message: events.record,
    kind: 'primary',
  }
  if (result._tag === 'Tracked') {
    return {
      tone: 'neutral',
      heading: 'Your pitch',
      lines: [],
      body: curveView(`take-${takeNumber}`, result.curve, events.paint, h),
      action: again,
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
      }
    : {
        tone: 'problem',
        heading: 'That take was too noisy to track',
        lines: [
          'There was more sound around you than voice. Try somewhere quieter, or closer to the microphone.',
        ],
        action: again,
      }
}

export const takePanel = <ViewMessage>(
  take: Take,
  events: TakePanelEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html => {
  const screen = screenOf(take, events, h)
  const action = screen.action
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
        [h.AriaLive('polite'), h.Class('flex flex-col gap-2 empty:hidden')],
        screen.lines.map(line =>
          h.p([h.Class('text-base text-muted break-words')], [line]),
        ),
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
              ],
            ),
          ]),
    ],
  )
}
