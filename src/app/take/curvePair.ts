import { Array, Effect, Match, Option, Schema, Stream } from 'effect'
import { Mount } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineTaggedUnion } from 'foldkit/schema'

import { type CurveWindow, finishedWindow } from '../../engine/draw/curve'
import {
  type MarkedStretch,
  type PairColours,
  drawCurvePair,
} from '../../engine/draw/curve-pair'
import {
  type LiveCurve,
  createLiveCurve,
  finishedLiveCurve,
  windowCurve,
} from '../../engine/draw/live-curve'
import { swiftF0FrameHz } from '../../engine/pitch/swift-f0'
import { medianVoicedHz } from '../../score/curve'
import type { LiveFrames } from '../../services/tracker'
import { Message } from '../message'
import { liveFramesOf } from './liveFrames'
import { TakeCurve, longestTakeSeconds } from './take'

// The native's curve and the learner's, stacked: the native's drawn once
// on the lower canvas, the learner's on the upper one, live during a take
// (its frames fed to the plain painter's ring buffer as the tracker finds
// them, never through the Model), whole once it has finished, and lined
// up with the native's once it has been scored, with the worst stretch
// shaded behind both. Both are drawn by the plain painter on each
// animation frame that changes the picture
// (../../engine/draw/curve-pair.ts).

export const PairLearner = defineTaggedUnion({
  // The line alone, before a take.
  None: {},
  // Take `takeNumber`, drawn as its frames come.
  Live: { takeNumber: Schema.Finite },
  // A finished take's curve, from its own onset.
  Finished: { curve: TakeCurve },
  // A scored take's pitch at each of the native's frames, through the
  // score's alignment, around the take's own median; the native's frames
  // `fromFrame` to `toFrame` are its worst stretch.
  Aligned: {
    f0Hz: Schema.Array(Schema.Finite),
    medianHz: Schema.Finite,
    mark: Schema.Struct({ fromFrame: Schema.Finite, toFrame: Schema.Finite }),
  },
})
export type PairLearner = typeof PairLearner.Type

// Room for the longest take and its last frames.
const liveCapacity = Math.ceil((longestTakeSeconds + 1) * swiftF0FrameHz)

// The learner's canvas says how far the drawing has got, for the
// end-to-end tests that read and time it: frames painted, the newest
// voiced frame painted, and the seconds the width shows from the onset.
export const drawnFramesAttribute = 'drawn-frames'
export const drawnVoicedAttribute = 'drawn-last-voiced'
export const spanSecondsAttribute = 'span-seconds'

const colourOf = (style: CSSStyleDeclaration, token: string): string =>
  style.getPropertyValue(`--color-${token}`).trim()

export const pairColoursFrom = (element: Element): PairColours => {
  const style = getComputedStyle(element)
  return {
    native: colourOf(style, 'native'),
    ramp: Array.makeBy(5, step => colourOf(style, `closeness-${step + 1}`)),
    mark: colourOf(style, 'mark'),
    grid: colourOf(style, 'line'),
    median: colourOf(style, 'muted'),
    label: colourOf(style, 'muted'),
  }
}

const plainOf = (curve: TakeCurve) => ({
  f0Hz: Float32Array.from(curve.f0Hz),
  onsetFrame: curve.onsetFrame,
})

const canvasesIn = (element: Element) => {
  const native = element.querySelector('canvas[data-layer="native"]')
  const learner = element.querySelector('canvas[data-layer="learner"]')
  return native instanceof HTMLCanvasElement &&
    learner instanceof HTMLCanvasElement
    ? Option.some({ native, learner })
    : Option.none()
}

// Starts drawing the learner `learnerIn` makes for the native's window
// over `native` in `element`'s two canvases, `mark` shaded behind them.
const startDrawing = (
  element: Element,
  native: TakeCurve,
  learnerIn: (nativeWindow: CurveWindow) => LiveCurve | null,
  mark: MarkedStretch | null = null,
) => {
  const nativeWindow = finishedWindow(plainOf(native))
  return Option.flatMap(canvasesIn(element), canvases =>
    nativeWindow === null
      ? Option.none()
      : Option.some(
          drawCurvePair(
            canvases,
            nativeWindow,
            learnerIn(nativeWindow),
            () => pairColoursFrom(element),
            // NOTE: these attributes exist only for the end-to-end tests
            // (above, `drawnFramesAttribute`): nothing in the app reads them.
            painted => {
              canvases.learner.setAttribute(
                `data-${drawnFramesAttribute}`,
                String(painted.framesIn),
              )
              canvases.learner.setAttribute(
                `data-${drawnVoicedAttribute}`,
                String(painted.newestVoicedFrame),
              )
              canvases.learner.setAttribute(
                `data-${spanSecondsAttribute}`,
                (painted.spanFrames / swiftF0FrameHz).toFixed(3),
              )
            },
            mark,
          ),
        ),
  )
}

// What the upper canvas draws for a learner that is not live.
const stillLearner = (
  learner: Exclude<PairLearner, { _tag: 'Live' }>,
): Readonly<{
  learnerIn: (nativeWindow: CurveWindow) => LiveCurve | null
  mark: MarkedStretch | null
}> =>
  Match.value(learner).pipe(
    Match.tagsExhaustive({
      None: () => ({ learnerIn: () => null, mark: null }),
      Finished: ({ curve }) => ({
        learnerIn: () => finishedLiveCurve(Float32Array.from(curve.f0Hz)),
        mark: null,
      }),
      Aligned: ({ f0Hz, medianHz, mark }) => {
        const aligned = Float32Array.from(f0Hz)
        return {
          learnerIn: (nativeWindow: CurveWindow) =>
            windowCurve({
              f0At: frame => aligned[frame] ?? 0,
              firstFrame: nativeWindow.firstFrame,
              lastFrame: nativeWindow.lastFrame,
              medianHz,
            }),
          mark,
        }
      },
    }),
  )

const stopDrawing = (
  drawing: Option.Option<Readonly<{ stop: () => void }>>,
): Effect.Effect<void> =>
  Effect.sync(() => Option.map(drawing, ({ stop }) => stop()))

// The Mount that draws, for a program whose Message has `completed` and
// whose live frames come from `framesOf`, so the /dev library's entries
// can draw recorded curves with their own.
export const defineDrawCurvePair = <const Completed extends Schema.Top>(
  completed: Completed,
  makeCompleted: () => Schema.Schema.Type<Completed>,
  framesOf: (takeNumber: number) => Effect.Effect<Stream.Stream<LiveFrames>>,
) =>
  Mount.define('DrawCurvePair', {
    args: { native: TakeCurve, learner: PairLearner },
    messages: [completed],
    execute: ({ element, native, learner }) =>
      Effect.gen(function* () {
        if (learner._tag !== 'Live') {
          const { learnerIn, mark } = stillLearner(learner)
          yield* Effect.acquireRelease(
            Effect.sync(() => startDrawing(element, native, learnerIn, mark)),
            stopDrawing,
          )
          return makeCompleted()
        }
        // NOTE: the wait for the take's frames is the asynchronous part:
        // it stops if the canvas leaves first, and the drawing starts
        // only after it, so nothing is left to stop.
        const live = yield* Effect.acquireRelease(
          framesOf(learner.takeNumber).pipe(
            Effect.map(frames => {
              const curve = createLiveCurve(liveCapacity)
              return {
                frames,
                curve,
                drawing: startDrawing(element, native, () => curve),
              }
            }),
          ),
          ({ drawing }) => stopDrawing(drawing),
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

export const DrawCurvePair = defineDrawCurvePair(
  Message.CompletedDrawCurvePair,
  () => Message.CompletedDrawCurvePair(),
  liveFramesOf,
)

// A finished curve in words: its span from the onset, and its median.
export const describeCurve = (
  curve: TakeCurve,
): Readonly<{ seconds: number; medianHz: number }> => {
  const finished = finishedWindow(plainOf(curve))
  return finished === null
    ? { seconds: 0, medianHz: medianVoicedHz(new Float32Array(0)) }
    : {
        seconds: (finished.lastFrame - finished.firstFrame) / curve.frameHz,
        medianHz: finished.medianHz,
      }
}

const hzText = (hz: number): string => `${Math.round(hz)} Hz`

const closenessWords =
  'coloured blue where it is close to the line and orange where it is far'

const learnerLabel = (learner: PairLearner): Option.Option<string> =>
  PairLearner.match(learner, {
    None: () => Option.none(),
    Live: () =>
      Option.some(
        `Your pitch, drawn as you speak over the line's, in semitones around your typical pitch so far, ${closenessWords}.`,
      ),
    Finished: ({ curve }) => {
      const { seconds, medianHz } = describeCurve(curve)
      return Option.some(
        `Your pitch curve, ${seconds.toFixed(2)} s from your voice onset, in semitones around your typical pitch of ${hzText(medianHz)}, over the line's, ${closenessWords}.`,
      )
    },
    Aligned: ({ medianHz }) =>
      Option.some(
        `Your pitch curve, lined up with the line's where the two were compared, in semitones around your typical pitch of ${hzText(medianHz)}, ${closenessWords}. The stretch where it differed most is shaded.`,
      ),
  })

const legend = <ViewMessage>(
  marked: boolean,
  h: HtmlBuilder<ViewMessage>,
): Html =>
  h.div(
    [
      h.AriaHidden(true),
      h.Class('flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink'),
    ],
    [
      h.span(
        [h.Class('inline-flex items-center gap-2')],
        [h.span([h.Class('h-1.5 w-6 rounded-full bg-native')]), 'The line'],
      ),
      h.span(
        [h.Class('inline-flex items-center gap-2')],
        [
          'Your curve: close',
          h.span(
            [h.Class('inline-flex overflow-hidden rounded-full')],
            Array.map(
              [
                'bg-closeness-1',
                'bg-closeness-2',
                'bg-closeness-3',
                'bg-closeness-4',
                'bg-closeness-5',
              ],
              colour => h.span([h.Class(`h-1.5 w-3 ${colour}`)]),
            ),
          ),
          'far',
        ],
      ),
      ...(marked
        ? [
            h.span(
              [h.Class('inline-flex items-center gap-2')],
              [
                h.span([h.Class('h-3.5 w-5 rounded-sm bg-mark')]),
                'Where it differed most',
              ],
            ),
          ]
        : []),
    ],
  )

// The two canvases and their legend. `key` names what the upper canvas
// shows (the line alone, a live take, a finished take), so each gets a
// new element and Mount: a Mount's args are read once, when its element
// enters the page. `note` says what the picture shows now.
export const curvePairView = <ViewMessage>(
  key: string,
  native: TakeCurve,
  learner: PairLearner,
  note: string,
  draw: (args: {
    native: TakeCurve
    learner: PairLearner
  }) => Mount.MountAction<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html => {
  const nativeMedian = describeCurve(native).medianHz
  const canvasClass = 'absolute inset-0 block h-full w-full'
  return h.figure(
    [h.Class('flex flex-col gap-3')],
    [
      h.keyed('div')(
        key,
        [
          h.Class(
            'relative h-56 w-full overflow-hidden rounded-md border border-line bg-surface sm:h-64',
          ),
          h.OnMount(draw({ native, learner })),
        ],
        [
          h.canvas([
            h.DataAttribute('layer', 'native'),
            h.Role('img'),
            h.AriaLabel(
              `The line's pitch curve, from the speaker's voice onset, in semitones around their typical pitch of ${hzText(nativeMedian)}.`,
            ),
            h.Class(canvasClass),
          ]),
          h.canvas([
            h.DataAttribute('layer', 'learner'),
            ...Option.match(learnerLabel(learner), {
              onNone: () => [h.AriaHidden(true)],
              onSome: label => [h.Role('img'), h.AriaLabel(label)],
            }),
            h.Class(canvasClass),
          ]),
        ],
      ),
      h.figcaption(
        [h.Class('flex flex-col gap-2')],
        [
          legend(learner._tag === 'Aligned', h),
          h.p([h.Class('text-sm text-muted')], [note]),
        ],
      ),
    ],
  )
}
