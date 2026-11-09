import { Schema } from 'effect'
import { Runtime, type Update } from 'foldkit'
import { Html, HtmlBuilder } from 'foldkit/html'

import { blindChart, describeBlindChart } from '../../history/blindChart'
import { type DevEntry, entryFrame } from '../entry'
import { sampleBlindTrends } from '../sampleReturns'

// A line's blind takes over time, on a line's history page: the sample
// learner's line come back most often, one come back a few times, and
// one taken blind once.

const most = sampleBlindTrends[0] ?? []
const charts = [
  { name: 'The line come back most', points: most },
  {
    name: 'A line come back a few times',
    points: sampleBlindTrends[Math.floor(sampleBlindTrends.length / 2)] ?? [],
  },
  { name: 'One blind take', points: sampleBlindTrends.at(-1) ?? [] },
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

export const readOut = (): string => describeBlindChart(most)

export const choices: ReadonlyArray<string> = [
  'Takes sit by when they were made, so a line come back after a month shows the gap. Would one column per return, evenly spaced, read more easily?',
  'Reached and missed takes differ by a filled or hollow dot. Should a missed one also sit on a different colour?',
  'The dashed line is the threshold a blind take needs for its line to come back later. Should it be named on the chart itself, not only beside it?',
]

export const view = (_model: Model, h: HtmlBuilder<never>): Html =>
  entryFrame(
    {
      title: 'Blind-take chart',
      summary:
        'A line’s blind takes over time, whether practice held, from a learner dealt from a seed who follows the return schedule.',
      demo: charts.map(({ name, points }) =>
        h.section(
          [h.Class('flex flex-col gap-2')],
          [
            h.h3([h.Class('text-base font-bold')], [name]),
            blindChart(points, h),
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
