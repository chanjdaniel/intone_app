import { Array, Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { countText, percentText } from './format'
import type { TrendPoint } from './history'

// A line's match over its takes, take by take, earliest on the left, from
// 0% at the foot to 100% at the top. A take that could not be compared
// has no point, and breaks the line there. The picture is described in
// words for a screen reader, as its first, best and latest.

const width = 600
const height = 160
const pad = 6

// Each run of scored takes, as SVG points.
export const trendRuns = (
  trend: ReadonlyArray<TrendPoint>,
): ReadonlyArray<string> => {
  const step = trend.length > 1 ? (width - 2 * pad) / (trend.length - 1) : 0
  const xOf = (index: number) =>
    trend.length > 1 ? pad + index * step : width / 2
  const yOf = (match: number) =>
    pad + (1 - Math.min(1, Math.max(0, match))) * (height - 2 * pad)
  return trend
    .reduce<Array<Array<string>>>(
      (runs, point, index) =>
        Option.match(point.maybeMatch, {
          onNone: () => (runs.at(-1)?.length === 0 ? runs : [...runs, []]),
          onSome: match => {
            const last = runs.at(-1) ?? []
            const pointText = `${xOf(index).toFixed(1)},${yOf(match).toFixed(1)}`
            return [...runs.slice(0, -1), [...last, pointText]]
          },
        }),
      [[]],
    )
    .filter(Array.isArrayNonEmpty)
    .map(run => run.join(' '))
}

export const describeTrend = (trend: ReadonlyArray<TrendPoint>): string => {
  const matches = Array.getSomes(Array.map(trend, point => point.maybeMatch))
  if (!Array.isArrayNonEmpty(matches)) {
    return `${countText(trend.length, 'take')}, none of them compared.`
  }
  const unscored = trend.length - matches.length
  return [
    `Your match over ${countText(trend.length, 'take')}:`,
    `first ${percentText(Array.headNonEmpty(matches))},`,
    `best ${percentText(Math.max(...matches))},`,
    `latest ${percentText(Array.lastNonEmpty(matches))}.`,
    ...(unscored > 0
      ? [`${countText(unscored, 'take')} could not be compared.`]
      : []),
  ].join(' ')
}

export const scoreTrend = <ViewMessage>(
  trend: ReadonlyArray<TrendPoint>,
  h: HtmlBuilder<ViewMessage>,
): Html => {
  const runs = trendRuns(trend)
  const single = runs.filter(run => !run.includes(' '))
  return h.figure(
    [h.Class('flex flex-col gap-2')],
    [
      h.div(
        [h.Class('flex gap-2')],
        [
          h.div(
            [
              h.AriaHidden(true),
              h.Class(
                'flex flex-col justify-between py-0.5 text-right text-xs text-muted',
              ),
            ],
            [h.span([], ['100%']), h.span([], ['50%']), h.span([], ['0%'])],
          ),
          h.svg(
            [
              h.ViewBox(`0 0 ${width} ${height}`),
              h.PreserveAspectRatio('none'),
              h.Role('img'),
              h.AriaLabel(describeTrend(trend)),
              h.Class(
                'h-40 w-full rounded-md border border-line bg-surface text-accent',
              ),
            ],
            [
              ...[pad, height / 2, height - pad].map(y =>
                h.line([
                  h.X1('0'),
                  h.X2(String(width)),
                  h.Y1(String(y)),
                  h.Y2(String(y)),
                  h.Stroke('var(--color-line)'),
                  h.StrokeWidth('1'),
                  h.VectorEffect('non-scaling-stroke'),
                ]),
              ),
              ...runs.map(points =>
                h.polyline([
                  h.Points(points),
                  h.Fill('none'),
                  h.Stroke('currentColor'),
                  h.StrokeWidth('2'),
                  h.StrokeLinejoin('round'),
                  h.StrokeLinecap('round'),
                  h.VectorEffect('non-scaling-stroke'),
                ]),
              ),
              // A lone scored take, between two that could not be
              // compared, is drawn as a short mark of its own.
              ...single.map(point => {
                const [x = '0', y = '0'] = point.split(',')
                return h.line([
                  h.X1(String(Number(x) - 3)),
                  h.X2(String(Number(x) + 3)),
                  h.Y1(y),
                  h.Y2(y),
                  h.Stroke('currentColor'),
                  h.StrokeWidth('6'),
                  h.StrokeLinecap('round'),
                  h.VectorEffect('non-scaling-stroke'),
                ])
              }),
            ],
          ),
        ],
      ),
      h.figcaption(
        [h.Class('text-sm text-muted')],
        ['Each take from your first, on the left, to your latest.'],
      ),
    ],
  )
}
