import { Effect, type Schema } from 'effect'
import { Mount } from 'foldkit'
import { type Html, type HtmlBuilder } from 'foldkit/html'

import {
  type CurveColours,
  backingSize,
  layOutCurve,
  paintCurve,
  plotArea,
} from '../../engine/draw/curve'
import { medianVoicedHz } from '../../score/curve'
import { Message } from '../message'
import { TakeCurve } from './take'

// The finished curve, drawn once by the plain painter on a canvas sized
// for the device's pixel ratio, and again only when its box changes size.

const colourOf = (style: CSSStyleDeclaration, token: string): string =>
  style.getPropertyValue(`--color-${token}`).trim()

export const coloursFrom = (element: Element): CurveColours => {
  const style = getComputedStyle(element)
  return {
    curve: colourOf(style, 'take'),
    grid: colourOf(style, 'line'),
    median: colourOf(style, 'muted'),
    label: colourOf(style, 'muted'),
  }
}

const toPlainCurve = (curve: TakeCurve) => ({
  f0Hz: Float32Array.from(curve.f0Hz),
  onsetFrame: curve.onsetFrame,
})

// The Mount that paints, for a program whose Message has `completed`, so
// the /dev library's entries can paint with their own.
export const definePaintCurve = <const Completed extends Schema.Top>(
  completed: Completed,
  makeCompleted: () => Schema.Schema.Type<Completed>,
) =>
  Mount.define('PaintCurve', {
    args: { curve: TakeCurve },
    messages: [completed],
    execute: ({ element, curve }) =>
      Effect.gen(function* () {
        const plain = toPlainCurve(curve)
        const paint = (): void => {
          if (!(element instanceof HTMLCanvasElement)) {
            return
          }
          const context = element.getContext('2d')
          // The content box, inside the border, which the bitmap fills.
          const width = element.clientWidth
          const height = element.clientHeight
          if (context === null || width === 0 || height === 0) {
            return
          }
          const pixelRatio = globalThis.devicePixelRatio || 1
          const backing = backingSize(width, height, pixelRatio)
          element.width = backing.width
          element.height = backing.height
          context.setTransform(
            backing.width / width,
            0,
            0,
            backing.height / height,
            0,
            0,
          )
          paintCurve(context, plain, { width, height }, coloursFrom(element))
        }
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            const observer = new ResizeObserver(paint)
            observer.observe(element)
            paint()
            return observer
          }),
          observer => Effect.sync(() => observer.disconnect()),
        )
        return makeCompleted()
      }),
  })

export const PaintCurve = definePaintCurve(Message.CompletedPaintCurve, () =>
  Message.CompletedPaintCurve(),
)

const formatSeconds = (seconds: number): string => `${seconds.toFixed(2)} s`

// What the canvas shows, in words: its span, and the pitch its middle
// line stands for.
export const describeCurve = (
  curve: TakeCurve,
): Readonly<{ seconds: number; medianHz: number }> => {
  const drawing = layOutCurve(toPlainCurve(curve), plotArea(1, 1))
  return drawing === null
    ? { seconds: 0, medianHz: medianVoicedHz(new Float32Array(0)) }
    : {
        seconds: (drawing.lastFrame - drawing.firstFrame) / curve.frameHz,
        medianHz: drawing.medianHz,
      }
}

// `key` names the take, so a new take's curve gets a new canvas: a
// Mount's args are read once, when its element enters the page.
export const curveView = <ViewMessage>(
  key: string,
  curve: TakeCurve,
  paint: (args: { curve: TakeCurve }) => Mount.MountAction<ViewMessage>,
  h: HtmlBuilder<ViewMessage>,
): Html => {
  const { seconds, medianHz } = describeCurve(curve)
  const span = formatSeconds(seconds)
  const median = `${Math.round(medianHz)} Hz`
  return h.figure(
    [h.Class('flex flex-col gap-2')],
    [
      h.keyed('canvas')(key, [
        h.Role('img'),
        h.AriaLabel(
          `Your pitch curve, ${span} from your voice onset, in semitones around your typical pitch of ${median}.`,
        ),
        h.DataAttribute('curve-seconds', seconds.toFixed(3)),
        h.Class('block h-56 w-full rounded-md border border-line bg-surface'),
        h.OnMount(paint({ curve })),
      ]),
      h.figcaption(
        [h.Class('text-sm text-muted')],
        [
          `From your voice onset, ${span}. The middle line is your typical pitch, ${median}; the lines are 3 semitones apart.`,
        ],
      ),
    ],
  )
}
