import { Array, Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import type { CouldNotCompareReason, TakeScore, Voice } from './take'

// The score card: after a take, how closely it followed this one clip, as
// "N% match to this clip" with its parts by name, and where it differed
// most, playable from both voices; or, when the take could not be scored
// fairly, what to try, and no number. It never says "accuracy", and never
// that a take is correct: it claims only what it compared (report
// section 3, "Combining the parts, and the wording").
//
// The summary and the stretch are two pieces, so the panel can put the
// summary in its live region, where a screen reader hears it once, when
// it appears, and keep the stretch's play buttons out of it.

type Scored = Extract<TakeScore, { _tag: 'Scored' }>

const percent = (share: number): number =>
  Math.round(100 * Math.min(1, Math.max(0, share)))

export const matchText = (score: Scored): string =>
  `${percent(score.match)}% match to this clip`

type Part = Readonly<{
  id: 'pitchAccent' | 'timing' | 'sounds'
  name: string
  share: number
}>

export const partsOf = (score: Scored): ReadonlyArray<Part> => [
  { id: 'pitchAccent', name: 'Pitch accent', share: score.parts.pitchAccent },
  { id: 'timing', name: 'Timing', share: score.parts.timing },
  ...Option.match(score.parts.maybeSounds, {
    onNone: () => [],
    onSome: share => [{ id: 'sounds' as const, name: 'Sounds', share }],
  }),
]

const comparedText = (score: Scored): string => {
  const names = Array.map(partsOf(score), ({ name }) => name.toLowerCase())
  const listed =
    names.length > 1
      ? `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`
      : (names[0] ?? '')
  return `Your take's ${listed}, compared with this one recording, with your own voice's pitch and speed taken out.`
}

export const provisionalText =
  "The scale is provisional: it has not yet been checked against a native speaker's judgement, so read it as a guide, not a grade."

// What to try for each reason a take could not be compared.
export const couldNotCompareText: Readonly<
  Record<
    CouldNotCompareReason,
    Readonly<{ heading: string; lines: ReadonlyArray<string> }>
  >
> = {
  TooQuiet: {
    heading: 'Your take was too quiet to compare',
    lines: [
      'The microphone hardly heard you.',
      'Speak closer to the microphone, or a little louder, then record again.',
    ],
  },
  TooLittleVoiced: {
    heading: 'Too little of your take could be compared',
    lines: [
      'Much of the line had no voice the tracker could follow.',
      'Try a quieter room, and say every part of the line aloud.',
    ],
  },
  LengthMismatch: {
    heading: "Your take was too far from the line's length to compare",
    lines: [
      'It was much longer or shorter than the line.',
      'Say the whole line, once, at about its own pace.',
    ],
  },
}

const partRow = <ViewMessage>(part: Part, h: HtmlBuilder<ViewMessage>): Html =>
  h.keyed('li')(
    part.id,
    [h.Class('flex flex-col gap-1.5')],
    [
      h.div(
        [h.Class('flex items-baseline justify-between gap-3')],
        [
          h.span([h.Class('text-base font-semibold text-ink')], [part.name]),
          h.span(
            [h.Class('text-base font-semibold tabular-nums text-ink')],
            [`${percent(part.share)}%`],
          ),
        ],
      ),
      h.div(
        [
          h.AriaHidden(true),
          h.Class('h-2 w-full overflow-hidden rounded-full bg-line'),
        ],
        [
          h.div([
            h.Class('h-full rounded-full bg-accent'),
            h.Style({ width: `${percent(part.share)}%` }),
          ]),
        ],
      ),
    ],
  )

// The match and its parts, for the panel's live region: shown and heard
// once, when the take's score comes.
export const scoreSummary = <ViewMessage>(
  score: Scored,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.div(
    [h.Class('flex flex-col gap-4')],
    [
      h.p(
        [h.Class('flex flex-wrap items-baseline gap-x-3 gap-y-1')],
        [
          h.span(
            [h.Class('text-5xl font-bold tabular-nums text-ink')],
            [`${percent(score.match)}%`],
          ),
          h.span(
            [h.Class('text-lg font-semibold text-ink')],
            [' match to this clip'],
          ),
        ],
      ),
      h.ul(
        [
          h.AriaLabel('Parts of the match'),
          h.Class('grid gap-4 sm:grid-cols-2 sm:gap-6'),
        ],
        Array.map(partsOf(score), part => partRow(part, h)),
      ),
      h.p([h.Class('text-sm text-muted')], [comparedText(score)]),
      ...(score.provisional
        ? [h.p([h.Class('text-sm text-muted')], [provisionalText])]
        : []),
    ],
  )

export type StretchControls<ViewMessage> = Readonly<{
  // Which voice's stretch plays now, if either.
  playing: Voice | 'Nothing'
  hear: (voice: Voice) => ViewMessage
  stop: ViewMessage
}>

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

const stretchButton = `inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-line bg-surface px-4 text-base font-semibold text-ink ${focusRing}`

const secondsText = (seconds: number): string => `${seconds.toFixed(2)} s`

// Where the take differed most: when in the line, and a button to hear
// each voice there, which while it plays stops it.
export const worstStretch = <ViewMessage>(
  score: Scored,
  controls: StretchControls<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html => {
  const { nativeFrom, nativeTo } = score.worstStretch
  const button = (voice: Voice, label: string): Html => {
    const playing = controls.playing === voice
    return h.button(
      [
        h.Type('button'),
        h.OnClick(playing ? controls.stop : controls.hear(voice)),
        h.Class(stretchButton),
      ],
      [
        h.span([h.AriaHidden(true), h.Class('text-sm')], [playing ? '■' : '▶']),
        playing ? 'Stop' : label,
      ],
    )
  }
  return h.section(
    [
      h.AriaLabelledBy('worst-stretch-heading'),
      h.Class('flex flex-col gap-3 border-t border-line pt-5'),
    ],
    [
      h.h3(
        [h.Id('worst-stretch-heading'), h.Class('text-base font-bold')],
        ['Where it differed most'],
      ),
      h.p(
        [h.Class('text-base text-muted')],
        [
          `From ${secondsText(nativeFrom)} to ${secondsText(nativeTo)} of the line, shaded on the curves. Hear both voices there.`,
        ],
      ),
      h.div(
        [h.Class('flex flex-wrap gap-3')],
        [
          button('Line', 'Hear the line there'),
          button('Take', 'Hear your take there'),
        ],
      ),
    ],
  )
}
