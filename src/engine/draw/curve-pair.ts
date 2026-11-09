import { semitonesFrom } from '../../score/curve'
import {
  type AxisColours,
  type CurveWindow,
  type Pen,
  createCurveStroker,
  createSmoother,
  fitCanvas,
  onePen,
  paintAxis,
  plotArea,
} from './curve'
import type { LiveCurve } from './live-curve'

// The native's curve and the learner's, on two stacked canvases: the
// native's below, with the axis, drawn once (and again only when the
// width's time scale or the canvas's size changes), and the learner's
// above, added to as its frames arrive. Each is drawn in semitones around
// its own speaker's median and from its own voice's onset, so a high and
// a low voice saying the same line draw the same shape. The learner's
// line is coloured by how close each frame is to the native's at about
// the same time since the onset, on a ramp from blue for close to orange
// for far, with no number.

// The learner's frame is compared with the native's frames this many
// frames either side of the same time since the onset: 9 frames of 16 ms,
// about 150 ms, as much as a learner's timing drifts within a mora.
export const closenessReachFrames = 9
// The ramp has this many steps, each this many semitones wide: 0 to 1
// semitone is the closest, 4 or more (or no native voice near) the
// farthest. An accent's fall in the fixtures drops 1.3 to 11 semitones,
// so a missed fall lands two or more steps from the right one.
export const closenessSteps = 5
export const closenessStepSemitones = 1

const nativeWidth = 5
const learnerWidth = 2.5

// The native curve as the learner's is compared with it: each frame's
// drawn pitch from the onset, in semitones from the native's median, NaN
// where unvoiced.
export type NativeReference = Readonly<{
  semitones: Float32Array
  spanFrames: number
}>

export const nativeReferenceOf = (native: CurveWindow): NativeReference => {
  const smoother = createSmoother()
  const semitones = new Float32Array(native.lastFrame - native.firstFrame + 1)
  for (let i = 0; i < semitones.length; i++) {
    const hz = smoother(native, native.firstFrame + i)
    semitones[i] = hz > 0 ? semitonesFrom(native.medianHz, hz) : Number.NaN
  }
  return { semitones, spanFrames: native.lastFrame - native.firstFrame }
}

// The ramp's step, 0 for the closest, for a learner's frame `offset`
// frames after the learner's onset at `semitones` from the learner's
// median.
export const closenessStep = (
  reference: NativeReference,
  offset: number,
  semitones: number,
): number => {
  let nearest = Number.POSITIVE_INFINITY
  const from = Math.max(0, offset - closenessReachFrames)
  const to = Math.min(
    reference.semitones.length - 1,
    offset + closenessReachFrames,
  )
  for (let i = from; i <= to; i++) {
    const distance = Math.abs(
      (reference.semitones[i] ?? Number.NaN) - semitones,
    )
    if (distance < nearest) {
      nearest = distance
    }
  }
  return Math.min(
    closenessSteps - 1,
    Math.floor(nearest / closenessStepSemitones),
  )
}

// How many frames the width shows from each onset: room for the native's
// line and a quarter more, at least half a second, and when the learner's
// runs past that, half as much again each time, so the native's canvas is
// drawn again only a few times in the longest take.
const fewestSpanFrames = 31
export const pairSpanFrames = (
  nativeSpanFrames: number,
  learnerSpanFrames: number,
): number => {
  let span = Math.max(fewestSpanFrames, Math.ceil(1.25 * nativeSpanFrames))
  while (span < learnerSpanFrames) {
    span = Math.ceil(1.5 * span)
  }
  return span
}

export type PairColours = AxisColours &
  Readonly<{
    native: string
    // From the closest to the farthest, `closenessSteps` of them.
    ramp: ReadonlyArray<string>
  }>

type Size = Readonly<{ width: number; height: number }>

// Paints the axis and the native's curve across `spanFrames` frames.
export const paintNativeLayer = (
  context: CanvasRenderingContext2D,
  size: Size,
  colours: PairColours,
  native: CurveWindow,
  spanFrames: number,
  stroke = createCurveStroker(),
): void => {
  const area = paintAxis(context, size, colours)
  stroke(context, area, native, spanFrames, onePen(nativeWidth, colours.native))
}

// The learner's pen: each frame's colour by its closeness to the native.
export const learnerPen = (
  colours: PairColours,
  learner: CurveWindow,
  reference: NativeReference,
): Pen => ({
  width: learnerWidth,
  colours: colours.ramp,
  colourAt: (frame, hz) =>
    closenessStep(
      reference,
      frame - learner.firstFrame,
      semitonesFrom(learner.medianHz, hz),
    ),
})

// Clears the learner's canvas and paints its curve across `spanFrames`.
export const paintLearnerLayer = (
  context: CanvasRenderingContext2D,
  size: Size,
  colours: PairColours,
  learner: CurveWindow | null,
  reference: NativeReference,
  spanFrames: number,
  stroke = createCurveStroker(),
): void => {
  context.clearRect(0, 0, size.width, size.height)
  if (learner !== null) {
    stroke(
      context,
      plotArea(size.width, size.height),
      learner,
      spanFrames,
      learnerPen(colours, learner, reference),
    )
  }
}

export type PairPainting = Readonly<{
  framesIn: number
  newestVoicedFrame: number
  spanFrames: number
}>

export type CurvePairDrawing = Readonly<{
  // Stops drawing; the canvases keep their last picture.
  stop: () => void
}>

// Draws the native's curve on `canvases.native` and `learner` on
// `canvases.learner` on each animation frame that changes either, at the
// canvases' size and the device's pixel ratio, until stopped. With no
// learner, only the native's line is drawn. `colours` is read again when
// the canvases change size; `painted` hears each paint of the learner's.
export const drawCurvePair = (
  canvases: Readonly<{
    native: HTMLCanvasElement
    learner: HTMLCanvasElement
  }>,
  native: CurveWindow,
  learner: LiveCurve | null,
  colours: () => PairColours,
  painted: (painting: PairPainting) => void,
): CurvePairDrawing => {
  const nativeContext = canvases.native.getContext('2d')
  const learnerContext = canvases.learner.getContext('2d')
  const reference = nativeReferenceOf(native)
  const strokeNative = createCurveStroker()
  const strokeLearner = createCurveStroker()
  let resized = true
  let frameRequest = 0
  let currentColours = colours()
  let nativeSize: Size | null = null
  let learnerSize: Size | null = null
  let paintedSpan = -1
  const observer = new ResizeObserver(() => {
    resized = true
  })
  observer.observe(canvases.native)

  const onFrame = (nowMs: number): void => {
    frameRequest = requestAnimationFrame(onFrame)
    const moved = learner?.advance(nowMs) ?? false
    if (nativeContext === null || learnerContext === null) {
      return
    }
    if (resized) {
      nativeSize = fitCanvas(canvases.native, nativeContext)
      learnerSize = fitCanvas(canvases.learner, learnerContext)
      currentColours = colours()
    }
    if (nativeSize === null || learnerSize === null) {
      return
    }
    const window = learner?.window() ?? null
    const spanFrames = pairSpanFrames(
      reference.spanFrames,
      window === null ? 0 : window.lastFrame - window.firstFrame,
    )
    const rescaled = spanFrames !== paintedSpan
    if (resized || rescaled) {
      paintNativeLayer(
        nativeContext,
        nativeSize,
        currentColours,
        native,
        spanFrames,
        strokeNative,
      )
    }
    if (resized || rescaled || moved) {
      paintLearnerLayer(
        learnerContext,
        learnerSize,
        currentColours,
        window,
        reference,
        spanFrames,
        strokeLearner,
      )
      painted({
        framesIn: learner?.framesIn() ?? 0,
        newestVoicedFrame: learner?.newestVoicedFrame() ?? -1,
        spanFrames,
      })
    }
    resized = false
    paintedSpan = spanFrames
  }
  frameRequest = requestAnimationFrame(onFrame)

  return {
    stop: () => {
      cancelAnimationFrame(frameRequest)
      observer.disconnect()
    },
  }
}
