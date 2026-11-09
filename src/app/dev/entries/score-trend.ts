import { Schema } from 'effect'
import { Runtime, type Update } from 'foldkit'
import { Html, HtmlBuilder } from 'foldkit/html'

import { describeTrend, scoreTrend } from '../../history/trend'
import { type DevEntry, entryFrame } from '../entry'
import { sampleTrend } from '../sampleHistory'

// A line's match over its takes, on a line's history page: the sample
// history's busiest line, its first few takes, and a single take.

const trends = [
  { name: 'The busiest line', trend: sampleTrend },
  { name: 'Its first eight takes', trend: sampleTrend.slice(0, 8) },
  { name: 'One take', trend: sampleTrend.slice(-1) },
] as const

// MODEL

export const Model = Schema.Struct({})
export type Model = typeof Model.Type

// INIT

export const init: Runtime.ElementInit<Model, never> = () => ({ model: {} })

// UPDATE

export const update = (model: Model): Update.Return<Model, never> => ({
  model,
})

// VIEW

export const readOut = (): string => describeTrend(sampleTrend)

export const choices: ReadonlyArray<string> = [
  'Every take is a point, so a long practice draws a dense line. Should it show each day’s best instead once there are many takes?',
  'A take that could not be compared breaks the line rather than dropping to 0%. Is a gap clear enough, or should it be marked?',
  'Takes scored by an earlier version of the score are drawn like the rest. Should they look different until they are scored again?',
]

export const view = (_model: Model, h: HtmlBuilder<never>): Html =>
  entryFrame(
    {
      title: 'Score trend',
      summary: 'A line’s match over its takes, from the sample history.',
      demo: trends.map(({ name, trend }) =>
        h.section(
          [h.Class('flex flex-col gap-2')],
          [
            h.h3([h.Class('text-base font-bold')], [name]),
            scoreTrend(trend, h),
          ],
        ),
      ),
      readOut: readOut(),
      choices,
    },
    h,
  )

export const entry: DevEntry = {
  makeProgram: container =>
    Runtime.makeElement({ Model, init, update, view, container }),
}
