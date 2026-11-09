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

export type CurveDrawing = Readonly<{
  medianHz: number
  // The frames drawn: from the onset to the last voiced frame.
  firstFrame: number
  lastFrame: number
  // Each run of voiced frames, as points.
  runs: ReadonlyArray<ReadonlyArray<Point>>
}>

// The x of `frame`, in a drawing from `firstFrame` to `lastFrame`.
export const xOfFrame = (
  area: PlotArea,
  firstFrame: number,
  lastFrame: number,
  frame: number,
): number =>
  lastFrame === firstFrame
    ? area.left + area.width / 2
    : area.left + ((frame - firstFrame) / (lastFrame - firstFrame)) * area.width

// Where each frame of `curve` goes in `area`; null for a curve with no
// voiced frame.
export const layOutCurve = (
  curve: Pick<Curve, 'f0Hz' | 'onsetFrame'>,
  area: PlotArea,
): CurveDrawing | null => {
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
  const runs: Array<Array<Point>> = []
  let run: Array<Point> = []
  for (let frame = onsetFrame; frame <= lastFrame; frame++) {
    const hz = f0Hz[frame] ?? 0
    if (hz > 0) {
      const semitones = Math.max(
        -semitoneReach,
        Math.min(semitoneReach, semitonesFrom(medianHz, hz)),
      )
      run.push({
        x: xOfFrame(area, onsetFrame, lastFrame, frame),
        y: yOfSemitones(area, semitones),
      })
    } else if (run.length > 0) {
      runs.push(run)
      run = []
    }
  }
  if (run.length > 0) {
    runs.push(run)
  }
  return { medianHz, firstFrame: onsetFrame, lastFrame, runs }
}

export type CurveColours = Readonly<{
  curve: string
  grid: string
  median: string
  label: string
}>

// Paints the axis and `curve` over the whole of a `width` by `height`
// CSS-pixel context.
export const paintCurve = (
  context: CanvasRenderingContext2D,
  curve: Pick<Curve, 'f0Hz' | 'onsetFrame'>,
  size: Readonly<{ width: number; height: number }>,
  colours: CurveColours,
): void => {
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

  const drawing = layOutCurve(curve, area)
  if (drawing === null) {
    return
  }
  context.strokeStyle = colours.curve
  context.fillStyle = colours.curve
  context.lineWidth = lineWidth
  context.lineJoin = 'round'
  context.lineCap = 'round'
  for (const run of drawing.runs) {
    const [first, ...rest] = run
    if (first === undefined) {
      continue
    }
    if (rest.length === 0) {
      context.beginPath()
      context.arc(first.x, first.y, lineWidth / 2, 0, 2 * Math.PI)
      context.fill()
      continue
    }
    context.beginPath()
    context.moveTo(first.x, first.y)
    for (const point of rest) {
      context.lineTo(point.x, point.y)
    }
    context.stroke()
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
