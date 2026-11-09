import { Array, Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { starThresholds } from '../../score/stars'
import { countText, dayText, percentText } from './format'
import type { BlindPoint } from './history'

// A line's blind takes over time, the app's own measure of whether
// practice held (report section 5): each blind take at its time, from
// the first on the left to the latest on the right, 0% at the foot and
// 100% at the top, with the clip's threshold drawn across as a dashed
// line. A take that reached it is a filled dot, one under it a hollow
// one, so the two differ by shape and not by colour alone; a take that
// could not be compared has no dot, and breaks the line there. To a
// screen reader the picture is its summary: the first, latest and best.

const width = 600
const height = 160
const pad = 8
const dotRadius = 5

const percent = (share: number): number => Math.round(100 * share)

const yOf = (match: number): number =>
  pad + (1 - Math.min(1, Math.max(0, match))) * (height - 2 * pad)

// Where a match sits from the top, as a share of the picture's height,
// for the labels beside it.
const topShareOf = (match: number): number => yOf(match) / height

export type ChartDot = Readonly<{ x: number; y: number; reached: boolean }>

// Each blind take's dot, by its time, and each run of compared takes as
// SVG points.
export const blindChartOf = (
  points: ReadonlyArray<BlindPoint>,
): Readonly<{
  dots: ReadonlyArray<ChartDot>
  runs: ReadonlyArray<string>
}> => {
  const reach = percent(starThresholds().reach)
  const first = points[0]?.takenAt ?? 0
  const span = (points.at(-1)?.takenAt ?? 0) - first
  const xOf = (takenAt: number): number =>
    span > 0 ? pad + ((takenAt - first) / span) * (width - 2 * pad) : width / 2
  const placed = points.map(point =>
    Option.map(point.maybeMatch, match => ({
      x: xOf(point.takenAt),
      y: yOf(match),
      reached: percent(match) >= reach,
    })),
  )
  const runs = placed
    .reduce<Array<Array<ChartDot>>>(
      (soFar, maybeDot) =>
        Option.match(maybeDot, {
          onNone: () => (soFar.at(-1)?.length === 0 ? soFar : [...soFar, []]),
          onSome: dot => [
            ...soFar.slice(0, -1),
            [...(soFar.at(-1) ?? []), dot],
          ],
        }),
      [[]],
    )
    .filter(run => run.length > 1)
    .map(run =>
      run.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '),
    )
  return { dots: Array.getSomes(placed), runs }
}

export const describeBlindChart = (
  points: ReadonlyArray<BlindPoint>,
): string => {
  const reach = percent(starThresholds().reach)
  const matches = Array.getSomes(points.map(point => point.maybeMatch))
  const lead = `Your blind takes of this line: ${countText(points.length, 'take')}`
  if (!Array.isArrayNonEmpty(matches)) {
    return `${lead}, none of them compared. The threshold is ${reach}%.`
  }
  const reached = matches.filter(match => percent(match) >= reach).length
  const unscored = points.length - matches.length
  return [
    `${lead} from ${dayText(points[0]?.day ?? '')} to ${dayText(points.at(-1)?.day ?? '')}:`,
    `first ${percentText(Array.headNonEmpty(matches))},`,
    `latest ${percentText(Array.lastNonEmpty(matches))},`,
    `best ${percentText(Math.max(...matches))}.`,
    `${reached} of ${matches.length} reached the threshold of ${reach}%.`,
    ...(unscored > 0
      ? [`${countText(unscored, 'take')} could not be compared.`]
      : []),
  ].join(' ')
}

const axisLabel = <ViewMessage>(
  text: string,
  match: number,
  emphasis: boolean,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.span(
    [
      h.Class(
        `absolute right-0 -translate-y-1/2 leading-none ${emphasis ? 'font-semibold text-ink' : ''}`,
      ),
      h.Style({ top: `${(100 * topShareOf(match)).toFixed(2)}%` }),
    ],
    [text],
  )

export const blindChart = <ViewMessage>(
  points: ReadonlyArray<BlindPoint>,
  h: HtmlBuilder<ViewMessage>,
): Html => {
  const { reach } = starThresholds()
  const { dots, runs } = blindChartOf(points)
  const thresholdY = yOf(reach)
  return h.figure(
    [h.DataAttribute('blind-chart', ''), h.Class('flex flex-col gap-2 pt-2')],
    [
      h.div(
        [h.Class('flex gap-2')],
        [
          h.div(
            [
              h.AriaHidden(true),
              h.Class('relative w-8 shrink-0 text-right text-xs text-muted'),
            ],
            [
              axisLabel('100%', 1, false, h),
              axisLabel(`${percent(reach)}%`, reach, true, h),
              axisLabel('0%', 0, false, h),
            ],
          ),
          h.svg(
            [
              h.ViewBox(`0 0 ${width} ${height}`),
              h.Role('img'),
              h.AriaLabel(describeBlindChart(points)),
              h.Class(
                'block h-auto min-w-0 flex-1 rounded-md border border-line bg-surface text-accent',
              ),
            ],
            [
              ...[pad, height - pad].map(y =>
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
              h.line([
                h.DataAttribute('threshold', String(percent(reach))),
                h.X1('0'),
                h.X2(String(width)),
                h.Y1(thresholdY.toFixed(1)),
                h.Y2(thresholdY.toFixed(1)),
                h.Stroke('var(--color-ink)'),
                h.StrokeWidth('1.5'),
                h.StrokeDasharray('6 5'),
                h.VectorEffect('non-scaling-stroke'),
              ]),
              ...runs.map(run =>
                h.polyline([
                  h.Points(run),
                  h.Fill('none'),
                  h.Stroke('currentColor'),
                  h.StrokeWidth('2'),
                  h.StrokeLinejoin('round'),
                  h.StrokeLinecap('round'),
                  h.VectorEffect('non-scaling-stroke'),
                ]),
              ),
              ...dots.map(dot =>
                h.circle([
                  h.DataAttribute('reached', String(dot.reached)),
                  h.Cx(dot.x.toFixed(1)),
                  h.Cy(dot.y.toFixed(1)),
                  h.R(String(dotRadius)),
                  h.Fill(dot.reached ? 'currentColor' : 'var(--color-surface)'),
                  h.Stroke('currentColor'),
                  h.StrokeWidth('2'),
                  h.VectorEffect('non-scaling-stroke'),
                ]),
              ),
            ],
          ),
        ],
      ),
      h.div(
        [
          h.AriaHidden(true),
          h.Class('flex justify-between gap-4 pl-10 text-xs text-muted'),
        ],
        [
          h.span([], [dayText(points[0]?.day ?? '')]),
          ...(points.length > 1
            ? [h.span([], [dayText(points.at(-1)?.day ?? '')])]
            : []),
        ],
      ),
      h.figcaption(
        [h.Class('text-sm text-muted')],
        [
          `Each blind take, from your first on the left to your latest. The dashed line is ${percent(reach)}%: a filled dot reached it, a hollow one did not.`,
        ],
      ),
    ],
  )
}
