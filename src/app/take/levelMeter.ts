import type { Html, HtmlBuilder } from 'foldkit/html'

import { levelMeterFloorDb } from './take'

// The level meter shown while a take records: the microphone's loudest
// sound in each tenth of a second.

// The meter's fill, 0 to 1, for a level in dBFS.
const meterFill = (levelDb: number): number =>
  Math.min(1, Math.max(0, 1 - levelDb / levelMeterFloorDb))

// How the meter reads in words, for screen readers that ask; it is never
// announced as it moves.
export const describeLevel = (levelDb: number): string =>
  levelDb <= levelMeterFloorDb + 1
    ? 'silent'
    : levelDb < -40
      ? 'quiet'
      : levelDb < -6
        ? 'good'
        : 'very loud'

export const levelMeter = <ViewMessage>(
  levelDb: number,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.div(
    [h.Class('flex items-center gap-3')],
    [
      h.span(
        [h.AriaHidden(true), h.Class('shrink-0 text-sm text-muted')],
        ['Level'],
      ),
      h.div(
        [
          h.Role('meter'),
          h.AriaLabel('Microphone level'),
          h.AriaValuemin(levelMeterFloorDb),
          h.AriaValuemax(0),
          h.AriaValuenow(Math.round(levelDb)),
          h.AriaValuetext(describeLevel(levelDb)),
          h.Class(
            'relative h-2 w-full overflow-hidden rounded-full border border-line bg-surface',
          ),
        ],
        [
          h.div([
            h.Class(
              'absolute inset-y-0 left-0 rounded-full bg-take motion-safe:transition-[width] motion-safe:duration-100 motion-safe:ease-linear',
            ),
            h.Style({ width: `${(100 * meterFill(levelDb)).toFixed(1)}%` }),
          ]),
        ],
      ),
    ],
  )
