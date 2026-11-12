import { Option, Schema } from 'effect'
import { Runtime, type Update } from 'foldkit'
import { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { outcomeSummary } from '../../level/outcomeView'
import {
  type LineProgress,
  StarCount,
  TakeOutcome,
  outcomeOf,
} from '../../level/progress'
import { starRow, starRules, starsText } from '../../level/starRow'
import { TakeScore } from '../../take/take'
import { type DevEntry, entryFrame } from '../entry'

// A line's stars, 0 to 3, at both sizes, and what a take says of them:
// press a take to see it scored against the line's stars so far, by the
// app's own rules (src/score/stars.ts), the star it earns growing into
// place where motion is welcome.

const takes = [
  { name: 'Guided, 70%', mode: 'Guided', match: 0.7 },
  { name: 'Guided, 80%', mode: 'Guided', match: 0.8 },
  { name: 'Guided, 92%', mode: 'Guided', match: 0.92 },
  { name: 'Blind, 60%', mode: 'Blind', match: 0.6 },
  { name: 'Blind, 78%', mode: 'Blind', match: 0.78 },
  { name: 'Not compared', mode: 'Blind', match: null },
] as const

const TakeName = Schema.Literals(takes.map(take => take.name))
type TakeName = typeof TakeName.Type

// MODEL

export const Model = Schema.Struct({
  stars: StarCount,
  maybeBestMatch: Schema.Option(Schema.Finite),
  maybeLast: Schema.Option(
    Schema.Struct({
      take: TakeName,
      compared: Schema.Boolean,
      outcome: TakeOutcome,
    }),
  ),
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  ClickedTake: { take: TakeName },
  ClickedStartAgain: {},
})
export type Message = typeof Message.Type

// INIT

export const init: Runtime.ElementInit<Model, Message> = () => ({
  model: { stars: 0, maybeBestMatch: Option.none(), maybeLast: Option.none() },
})

// UPDATE

const scoreOf = (match: number | null): TakeScore =>
  match === null
    ? TakeScore.CouldNotCompare({ version: 1, reason: 'LengthMismatch' })
    : TakeScore.Scored({
        version: 1,
        match,
        parts: {
          pitchAccent: match,
          timing: match,
          maybeSounds: Option.none(),
        },
        worstStretch: {
          nativeFrom: 0,
          nativeTo: 0.4,
          takeFrom: 0,
          takeTo: 0.4,
        },
        provisional: true,
        alignedF0: [],
      })

const takeOf = (name: TakeName) =>
  takes.find(take => take.name === name) ?? takes[0]

export const update = (
  model: Model,
  message: Message,
): Update.Return<Model, Message> =>
  Message.match(message, {
    ClickedTake: ({ take }) => {
      const { mode, match } = takeOf(take)
      const before: LineProgress = {
        stars: model.stars,
        maybeBestMatch: model.maybeBestMatch,
      }
      const { after, outcome } = outcomeOf(before, mode, scoreOf(match))
      return {
        model: modifyFields(model, {
          stars: () => after.stars,
          maybeBestMatch: () => after.maybeBestMatch,
          maybeLast: () =>
            Option.some({ take, compared: match !== null, outcome }),
        }),
      }
    },
    ClickedStartAgain: () => init(),
  })

// VIEW

const sizesView = (h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('grid gap-3 sm:grid-cols-2')],
    ([0, 1, 2, 3] as const).map(stars =>
      h.div(
        [
          h.Class(
            'flex items-center justify-between gap-3 rounded-md border border-line bg-surface px-4 py-3',
          ),
        ],
        [
          h.span([h.Class('text-base text-ink')], [starsText(stars)]),
          h.span(
            [h.Class('flex items-center gap-3')],
            [starRow(stars, h), starRow(stars, h, { size: 'large' })],
          ),
        ],
      ),
    ),
  )

const lastOutcome = (model: Model, h: HtmlBuilder<Message>): Html =>
  Option.match(model.maybeLast, {
    onNone: () =>
      h.p(
        [h.Class('text-base text-muted')],
        ['Press a take to score it against the line’s stars so far.'],
      ),
    onSome: ({ compared, outcome }) => outcomeSummary(outcome, compared, h),
  })

export const readOut = (model: Model): string =>
  `${starsText(model.stars)}; best ${Option.match(model.maybeBestMatch, {
    onNone: () => 'none yet',
    onSome: best => `${Math.round(100 * best)}%`,
  })}; ${Option.match(model.maybeLast, {
    onNone: () => 'no take yet',
    onSome: ({ take }) => `last take ${take}`,
  })}`

export const choices: ReadonlyArray<string> = [
  'Stars are drawn in a dark gold, and those still to earn as grey outlines. Would you rather they were the accent blue, or another shape than a star?',
  'One star at 75% guided, two at 90% guided, three at 75% blind. Is a blind take at 75% the right step above a guided take at 90%, or should three ask for 90% blind too?',
  'A star just earned grows into place once; with reduced motion it simply appears. Is the growth welcome, or too much?',
  'The level’s heading sums its stars, such as 4 of 9. Should it say how many lines have all three instead?',
]

export const view = (model: Model, h: HtmlBuilder<Message>): Html =>
  entryFrame(
    {
      title: 'Star row',
      summary:
        'A line’s stars, from none to three, at the size of a level’s row and of the practice screen, and what a take says it did for them.',
      demo: [
        sizesView(h),
        h.div(
          [h.Class('flex flex-col gap-3')],
          [
            h.ul(
              [h.Class('flex flex-col gap-0.5 text-sm text-muted')],
              starRules().map(rule => h.li([], [rule])),
            ),
            h.div(
              [h.Class('flex flex-wrap gap-2')],
              [
                ...takes.map(take =>
                  h.button(
                    [
                      h.Type('button'),
                      h.OnClick(Message.ClickedTake({ take: take.name })),
                      h.Class(
                        `inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-4 text-base font-semibold text-ink focus-ring`,
                      ),
                    ],
                    [take.name],
                  ),
                ),
                h.button(
                  [
                    h.Type('button'),
                    h.OnClick(Message.ClickedStartAgain()),
                    h.Class(
                      `inline-flex min-h-11 items-center rounded-sm text-base font-semibold text-accent underline underline-offset-4 focus-ring`,
                    ),
                  ],
                  ['Start again'],
                ),
              ],
            ),
            h.div(
              [h.Class('flex items-center gap-3')],
              [
                starRow(model.stars, h, { size: 'large' }),
                h.span([h.Class('text-base text-ink')], ['The line now']),
              ],
            ),
            lastOutcome(model, h),
          ],
        ),
      ],
      readOut: readOut(model),
      choices,
    },
    h,
  )

export const entry: DevEntry = {
  makeProgram: container =>
    Runtime.makeElement({ Model, init, update, view, container }),
}
