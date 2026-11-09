import { Array, Option } from 'effect'
import type { Mount } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { SCORE_VERSION } from '../../score/constants'
import { lineOf } from '../line/lines'
import { scoredLearnerOf } from '../line/practiceView'
import { historyRouter, lineRouter } from '../route'
import { type PairLearner, curvePairView } from '../take/curvePair'
import { couldNotCompareText, matchText } from '../take/scoreCard'
import type { TakeCurve } from '../take/take'
import { countText, dayText } from './format'
import { LineHistoryPage, type ShownTake } from './history'
import { scoreTrend } from './trend'

// A line's history: its match over every take, and its first, best and
// latest takes, each drawn over the native it was scored against, with
// the version of the score that scored it.

export type LineHistoryEvents<ViewMessage> = Readonly<{
  draw: (args: {
    native: TakeCurve
    learner: PairLearner
  }) => Mount.MountAction<ViewMessage>
}>

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

const linkClass = `inline-flex min-h-11 items-center gap-1.5 rounded-md text-accent ${focusRing}`

// The takes the page draws, each once, named by what it is.
export const shownTakesOf = (
  first: ShownTake,
  maybeBest: Option.Option<ShownTake>,
  latest: ShownTake,
): ReadonlyArray<Readonly<{ name: string; take: ShownTake }>> => {
  const named = [
    { role: 'first', take: first },
    ...Option.match(maybeBest, {
      onNone: () => [],
      onSome: best => [{ role: 'best', take: best }],
    }),
    { role: 'latest', take: latest },
  ]
  const ids = Array.dedupe(named.map(({ take }) => take.id))
  return ids.flatMap(id => {
    const roles = named.filter(({ take }) => take.id === id)
    const take = roles[0]?.take
    if (take === undefined) {
      return []
    }
    const words = roles.map(({ role }) => role)
    const listed =
      words.length > 1
        ? `${words.slice(0, -1).join(', ')} and ${words.at(-1) ?? ''}`
        : (words[0] ?? '')
    return [
      {
        name: `${listed.charAt(0).toUpperCase()}${listed.slice(1)} take`,
        take,
      },
    ]
  })
}

export const versionText = (version: number): string =>
  version < SCORE_VERSION
    ? `Scored by version ${version} of the score, an earlier one than today’s ${SCORE_VERSION}.`
    : `Scored by version ${version} of the score.`

const takeCard = <ViewMessage>(
  name: string,
  take: ShownTake,
  events: LineHistoryEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html => {
  const { key, learner, note } = scoredLearnerOf(
    `history-${take.id}`,
    take.curve,
    take.score,
  )
  const headingId = `take-${take.id}-heading`
  return h.keyed('section')(
    take.id,
    [
      h.AriaLabelledBy(headingId),
      h.Class(
        'flex flex-col gap-3 rounded-lg border border-line bg-raised p-4 sm:p-5',
      ),
    ],
    [
      h.div(
        [
          h.Class(
            'flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1',
          ),
        ],
        [
          h.h3([h.Id(headingId), h.Class('text-lg font-bold')], [name]),
          h.p([h.Class('text-sm text-muted')], [dayText(take.day)]),
        ],
      ),
      h.p(
        [h.Class('text-2xl font-bold')],
        [
          take.score._tag === 'Scored'
            ? matchText(take.score)
            : couldNotCompareText[take.score.reason].heading,
        ],
      ),
      h.p([h.Class('text-sm text-muted')], [versionText(take.score.version)]),
      curvePairView(key, take.native, learner, note, events.draw, h),
    ],
  )
}

const statusBox = <ViewMessage>(
  text: string,
  role: 'status' | 'alert',
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.p(
    [
      h.Role(role),
      h.Class(
        `rounded-lg border border-line bg-raised p-5 text-base break-words ${role === 'alert' ? 'text-bad' : 'text-muted'}`,
      ),
    ],
    [text],
  )

const practiseLink = <ViewMessage>(
  clipId: string,
  lineId: string,
  h: HtmlBuilder<ViewMessage>,
): ReadonlyArray<Html> => [
  h.a(
    [h.Href(lineRouter({ clipId, lineId })), h.Class(linkClass)],
    [
      h.span([h.Class('underline underline-offset-4')], ['Practise this line']),
      h.span([h.AriaHidden(true)], ['→']),
    ],
  ),
]

export const lineHistoryView = <ViewMessage>(
  page: LineHistoryPage,
  events: LineHistoryEvents<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html => {
  const back = h.nav(
    [h.AriaLabel('Back')],
    [
      h.a(
        [
          h.Href(historyRouter({ maybeFind: Option.none() })),
          h.Class(linkClass),
        ],
        [
          h.span([h.AriaHidden(true)], ['←']),
          h.span([h.Class('underline underline-offset-4')], ['Your history']),
        ],
      ),
    ],
  )
  const lineHeading = (text: string, detail: string) =>
    h.header(
      [h.Class('flex flex-col gap-2')],
      [
        h.h1([h.Lang('ja'), h.Class('text-3xl font-bold sm:text-5xl')], [text]),
        h.p([h.Class('text-base text-muted')], [detail]),
      ],
    )
  const textOf = (clipId: string, lineId: string) =>
    Option.match(lineOf(clipId, lineId), {
      onNone: () => 'This line',
      onSome: line => line.text,
    })
  const body = LineHistoryPage.match<ReadonlyArray<Html>>(page, {
    NotLoaded: () => [
      statusBox('Reading this line’s takes from this device.', 'status', h),
    ],
    Loading: () => [
      statusBox('Reading this line’s takes from this device.', 'status', h),
    ],
    Failed: ({ clipId, lineId, reason }) => [
      lineHeading(textOf(clipId, lineId), 'Your takes of this line'),
      statusBox(`This line’s takes could not be read. ${reason}`, 'alert', h),
    ],
    Empty: ({ clipId, lineId }) => [
      lineHeading(
        textOf(clipId, lineId),
        'No takes of this line are kept on this device.',
      ),
      ...practiseLink(clipId, lineId, h),
    ],
    Ready: ({ clipId, lineId, lineText, trend, first, maybeBest, latest }) => [
      lineHeading(
        lineText,
        `${countText(trend.length, 'take')} since ${dayText(first.day)}`,
      ),
      ...practiseLink(clipId, lineId, h),
      h.section(
        [h.AriaLabelledBy('trend-heading'), h.Class('flex flex-col gap-3')],
        [
          h.h2(
            [h.Id('trend-heading'), h.Class('text-xl font-bold')],
            ['Your match over time'],
          ),
          scoreTrend(trend, h),
        ],
      ),
      h.section(
        [h.AriaLabelledBy('takes-heading'), h.Class('flex flex-col gap-4')],
        [
          h.h2(
            [h.Id('takes-heading'), h.Class('text-xl font-bold')],
            ['Your takes over the line'],
          ),
          ...shownTakesOf(first, maybeBest, latest).map(({ name, take }) =>
            takeCard(name, take, events, h),
          ),
        ],
      ),
    ],
  })
  return h.main(
    [h.Class('min-h-screen bg-surface text-ink px-4 py-6 sm:px-6 sm:py-10')],
    [
      h.div(
        [h.Class('mx-auto flex max-w-2xl flex-col gap-6')],
        [back, ...body],
      ),
    ],
  )
}
