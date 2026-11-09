import { type Curve, medianVoicedHz, semitonesFrom } from '../../score/curve'

// The plain painter for a finished curve: a semitone axis around the
// speaker's own median, confident frames only, a gap at every unvoiced
// frame, from the voice's onset to its last voiced frame. It draws in CSS
// pixels on a context the caller has scaled for the device's pixel ratio.

// The axis reaches this far either side of the median: two octaves in
// all, past any speaker's accent span, so every curve is drawn at the
// same scale.
export const semitoneReach = 12
// Grid lines every this many semitones.
const gridStep = 3
// Room around the plot, in CSS pixels: on the left for the axis labels.
export const plotInset = { top: 10, right: 12, bottom: 10, left: 36 } as const
const lineWidth = 2.5

export type PlotArea = Readonly<{
  left: number
  top: number
  width: number
  height: number
}>

export const plotArea = (width: number, height: number): PlotArea => ({
  left: plotInset.left,
  top: plotInset.top,
  width: Math.max(0, width - plotInset.left - plotInset.right),
  height: Math.max(0, height - plotInset.top - plotInset.bottom),
})

// The y of a pitch `semitones` from the median, and back.
export const yOfSemitones = (area: PlotArea, semitones: number): number =>
  area.top + ((semitoneReach - semitones) / (2 * semitoneReach)) * area.height

export const semitonesOfY = (area: PlotArea, y: number): number =>
  semitoneReach - ((y - area.top) / area.height) * 2 * semitoneReach

export type Point = Readonly<{ x: number; y: number }>

// What a painting shows of a curve: frames `firstFrame` to `lastFrame`,
// across the width of `spanFrames` frames from `firstFrame`, in semitones
// around `medianHz`. `f0At` reads a frame, 0 where unvoiced.
export type CurveWindow = Readonly<{
  f0At: (frame: number) => number
  firstFrame: number
  lastFrame: number
  spanFrames: number
  medianHz: number
}>

// The x of `frame`, a lone frame in the middle.
export const xOfFrame = (
  area: PlotArea,
  window: Pick<CurveWindow, 'firstFrame' | 'spanFrames'>,
  frame: number,
): number =>
  window.spanFrames === 0
    ? area.left + area.width / 2
    : area.left + ((frame - window.firstFrame) / window.spanFrames) * area.width

// The y of a voiced `hz`, held at the axis's edge past its reach.
export const yOfHz = (area: PlotArea, medianHz: number, hz: number): number =>
  yOfSemitones(
    area,
    Math.max(
      -semitoneReach,
      Math.min(semitoneReach, semitonesFrom(medianHz, hz)),
    ),
  )

// The window that shows a finished curve whole: from the onset to the
// last voiced frame, across the full width. Null with no voiced frame.
export const finishedWindow = (
  curve: Pick<Curve, 'f0Hz' | 'onsetFrame'>,
): CurveWindow | null => {
  const { f0Hz, onsetFrame } = curve
  const medianHz = medianVoicedHz(f0Hz)
  if (!Number.isFinite(medianHz)) {
    return null
  }
  let lastFrame = onsetFrame
  for (let frame = onsetFrame; frame < f0Hz.length; frame++) {
    if ((f0Hz[frame] ?? 0) > 0) {
      lastFrame = frame
    }
  }
  return {
    f0At: frame => f0Hz[frame] ?? 0,
    firstFrame: onsetFrame,
    lastFrame,
    spanFrames: lastFrame - onsetFrame,
    medianHz,
  }
}

export type CurveDrawing = Readonly<{
  medianHz: number
  // The frames drawn: from the onset to the last voiced frame.
  firstFrame: number
  lastFrame: number
  // Each run of voiced frames, as points.
  runs: ReadonlyArray<ReadonlyArray<Point>>
}>

// Where each frame of `curve` goes in `area`; null for a curve with no
// voiced frame.
export const layOutCurve = (
  curve: Pick<Curve, 'f0Hz' | 'onsetFrame'>,
  area: PlotArea,
): CurveDrawing | null => {
  const window = finishedWindow(curve)
  if (window === null) {
    return null
  }
  const runs: Array<Array<Point>> = []
  let run: Array<Point> = []
  for (let frame = window.firstFrame; frame <= window.lastFrame; frame++) {
    const hz = window.f0At(frame)
    if (hz > 0) {
      run.push({
        x: xOfFrame(area, window, frame),
        y: yOfHz(area, window.medianHz, hz),
      })
    } else if (run.length > 0) {
      runs.push(run)
      run = []
    }
  }
  if (run.length > 0) {
    runs.push(run)
  }
  return {
    medianHz: window.medianHz,
    firstFrame: window.firstFrame,
    lastFrame: window.lastFrame,
    runs,
  }
}

export type CurveColours = Readonly<{
  curve: string
  grid: string
  median: string
  label: string
}>

// Clears a `width` by `height` CSS-pixel context and paints the semitone
// axis: a line every 3 semitones, the median's darker, labels every 6.
export const paintAxis = (
  context: CanvasRenderingContext2D,
  size: Readonly<{ width: number; height: number }>,
  colours: CurveColours,
): PlotArea => {
  const area = plotArea(size.width, size.height)
  context.clearRect(0, 0, size.width, size.height)

  context.font = '11px system-ui, sans-serif'
  context.textAlign = 'right'
  context.textBaseline = 'middle'
  context.lineWidth = 1
  for (
    let semitones = -semitoneReach;
    semitones <= semitoneReach;
    semitones += gridStep
  ) {
    // Half-pixel offsets keep one-pixel lines on one row of pixels.
    const y = Math.round(yOfSemitones(area, semitones)) + 0.5
    context.strokeStyle = semitones === 0 ? colours.median : colours.grid
    context.beginPath()
    context.moveTo(area.left, y)
    context.lineTo(area.left + area.width, y)
    context.stroke()
    if (semitones % 6 === 0) {
      context.fillStyle = colours.label
      context.fillText(
        semitones > 0
          ? `+${semitones}`
          : semitones < 0
            ? `\u2212${-semitones}`
            : '0',
        area.left - 8,
        y,
      )
    }
  }
  return area
}

// Strokes each run of voiced frames in `window`, a dot for a lone frame,
// allocating nothing, so it can run on every animation frame.
export const strokeCurve = (
  context: CanvasRenderingContext2D,
  area: PlotArea,
  window: CurveWindow,
  colour: string,
): void => {
  context.strokeStyle = colour
  context.fillStyle = colour
  context.lineWidth = lineWidth
  context.lineJoin = 'round'
  context.lineCap = 'round'
  let runLength = 0
  let lastX = 0
  let lastY = 0
  const endRun = (): void => {
    if (runLength === 1) {
      context.beginPath()
      context.arc(lastX, lastY, lineWidth / 2, 0, 2 * Math.PI)
      context.fill()
    } else if (runLength > 1) {
      context.stroke()
    }
    runLength = 0
  }
  for (let frame = window.firstFrame; frame <= window.lastFrame; frame++) {
    const hz = window.f0At(frame)
    if (hz > 0) {
      lastX = xOfFrame(area, window, frame)
      lastY = yOfHz(area, window.medianHz, hz)
      if (runLength === 0) {
        context.beginPath()
        context.moveTo(lastX, lastY)
      } else {
        context.lineTo(lastX, lastY)
      }
      runLength++
    } else {
      endRun()
    }
  }
  endRun()
}

// Paints the axis and `curve` over the whole of a `width` by `height`
// CSS-pixel context.
export const paintCurve = (
  context: CanvasRenderingContext2D,
  curve: Pick<Curve, 'f0Hz' | 'onsetFrame'>,
  size: Readonly<{ width: number; height: number }>,
  colours: CurveColours,
): void => {
  const area = paintAxis(context, size, colours)
  const window = finishedWindow(curve)
  if (window !== null) {
    strokeCurve(context, area, window, colours.curve)
  }
}

// The canvas's backing size for a `width` by `height` CSS-pixel box at
// `pixelRatio`, so each CSS pixel has whole device pixels behind it.
export const backingSize = (
  width: number,
  height: number,
  pixelRatio: number,
): Readonly<{ width: number; height: number }> => ({
  width: Math.max(1, Math.round(width * pixelRatio)),
  height: Math.max(1, Math.round(height * pixelRatio)),
})
