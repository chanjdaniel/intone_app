import { Effect, Option, Schema, Stream } from 'effect'
import { Mount } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { createLiveCurve, drawLiveCurve } from '../../engine/draw/live-curve'
import { swiftF0FrameHz } from '../../engine/pitch/swift-f0'
import type { LiveFrames } from '../../services/tracker'
import { Message } from '../message'
import { coloursFrom } from './curveView'
import { liveFramesOf } from './liveFrames'
import { levelMeterFloorDb, longestTakeSeconds } from './take'

// The learner's curve drawn live during a take, and the level meter
// beside it. The canvas's Mount waits for its take's frames, feeds them
// to the plain painter's ring buffer as they come, and the painter draws
// on each animation frame that changes the picture, never through the
// Model. When the frames end, with the take, the curve snaps to its
// finished window.

// Room for the longest take and its last frames.
const liveCapacity = Math.ceil((longestTakeSeconds + 1) * swiftF0FrameHz)

// The canvas says how far the drawing has got, for the end-to-end tests
// that time it: frames painted, and the newest voiced frame painted.
export const drawnFramesAttribute = 'drawn-frames'
export const drawnVoicedAttribute = 'drawn-last-voiced'

// The Mount that draws, for a program whose Message has `completed` and
// whose frames come from `framesOf`, so the /dev library's entry can
// draw a recorded curve with its own.
export const defineDrawLiveCurve = <const Completed extends Schema.Top>(
  completed: Completed,
  makeCompleted: () => Schema.Schema.Type<Completed>,
  framesOf: (takeNumber: number) => Effect.Effect<Stream.Stream<LiveFrames>>,
) =>
  Mount.define('DrawLiveCurve', {
    args: { takeNumber: Schema.Finite },
    messages: [completed],
    execute: ({ element, takeNumber }) =>
      Effect.gen(function* () {
        // NOTE: the wait for the take's frames is the asynchronous part:
        // it stops if the canvas leaves first, and the drawing starts
        // only after it, so nothing is left to stop.
        const live = yield* Effect.acquireRelease(
          framesOf(takeNumber).pipe(
            Effect.map(frames => {
              const curve = createLiveCurve(liveCapacity)
              const drawing =
                element instanceof HTMLCanvasElement
                  ? Option.some(
                      drawLiveCurve(
                        element,
                        curve,
                        () => coloursFrom(element),
                        painted => {
                          element.setAttribute(
                            `data-${drawnFramesAttribute}`,
                            String(painted.framesIn()),
                          )
                          element.setAttribute(
                            `data-${drawnVoicedAttribute}`,
                            String(painted.newestVoicedFrame()),
                          )
                        },
                      ),
                    )
                  : Option.none()
              return { frames, curve, drawing }
            }),
          ),
          ({ drawing }) =>
            Effect.sync(() => Option.map(drawing, ({ stop }) => stop())),
          { interruptible: true },
        )
        yield* live.frames.pipe(
          Stream.runForEach(frames =>
            Effect.sync(() => live.curve.append(frames)),
          ),
        )
        live.curve.finish()
        return makeCompleted()
      }),
  })

export const DrawLiveCurve = defineDrawLiveCurve(
  Message.CompletedDrawLiveCurve,
  () => Message.CompletedDrawLiveCurve(),
  liveFramesOf,
)

// The meter's fill, 0 to 1, for a level in dBFS.
export const meterFill = (levelDb: number): number =>
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

// The live canvas for take `takeNumber`. `key` keeps one canvas, and so
// one Mount, from the recording to its analysis: a Mount's args are read
// once, when its element enters the page.
export const liveCurveView = <ViewMessage>(
  takeNumber: number,
  caption: string,
  draw: (args: { takeNumber: number }) => Mount.MountAction<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.figure(
    [h.Class('flex flex-col gap-2')],
    [
      h.keyed('canvas')(`live-${takeNumber}`, [
        h.Role('img'),
        h.AriaLabel(
          'Your pitch, drawn as you speak, in semitones around your typical pitch so far.',
        ),
        h.Class('block h-56 w-full rounded-md border border-line bg-surface'),
        h.OnMount(draw({ takeNumber })),
      ]),
      h.figcaption([h.Class('text-sm text-muted')], [caption]),
    ],
  )
