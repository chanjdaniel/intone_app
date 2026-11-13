import { type Curve, medianVoicedHz, semitonesFrom } from '../../score/curve'

// The plain painter: a semitone axis around a speaker's own median, and a
// curve on it from the voice's onset, drawn as the ear hears it. Jitter is
// smoothed for display only, short gaps are bridged with a dashed line and
// longer ones are left empty. It reads a curve's frames and never writes
// them, so the raw frames kept for scoring are never changed. It draws in
// CSS pixels on a context the caller has scaled for the device's pixel
// ratio.

// The axis reaches this far either side of the median: two octaves in
// all, past any speaker's accent span, so every curve is drawn at the
// same scale.
export const semitoneReach = 12
// Grid lines every this many semitones.
const gridStep = 3
// Room around the plot, in CSS pixels: on the left for the axis labels.
export const plotInset = { top: 10, right: 12, bottom: 10, left: 36 } as const

// A gap of up to this many unvoiced frames between two voiced ones is
// bridged with a dashed line: 9 frames of 16 ms, about 150 ms, the length
// of a devoiced mora or a stop's closure, which the ear hears through.
export const bridgedGapFrames = 9
// Each frame is drawn at the median of its run's voiced frames this far
// either side: 5 frames, 80 ms, which removes a one or two frame octave
// slip and the tracker's frame-to-frame jitter but keeps an accent's fall,
// which takes longer.
export const smoothingReach = 2
const dash: Array<number> = [4, 4]
const none: Array<number> = []

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

// What a painting shows of a curve: frames `firstFrame` to `lastFrame`, in
// semitones around `medianHz`. `f0At` reads a frame, 0 where unvoiced.
export type CurveWindow = Readonly<{
  f0At: (frame: number) => number
  firstFrame: number
  lastFrame: number
  medianHz: number
}>

// The x of `frame` when the plot's width shows `spanFrames` frames from
// `firstFrame`; a lone frame in the middle.
export const xOfFrame = (
  area: PlotArea,
  firstFrame: number,
  spanFrames: number,
  frame: number,
): number =>
  spanFrames === 0
    ? area.left + area.width / 2
    : area.left + ((frame - firstFrame) / spanFrames) * area.width

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
// last voiced frame. Null with no voiced frame.
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
    medianHz,
  }
}

// The pitch a voiced frame is drawn at: the median of the voiced frames
// of its own run within `smoothingReach` of it, never reaching across a
// gap or out of the window; 0 for an unvoiced frame. One smoother keeps
// its own scratch space, so reading through it allocates nothing.
export type Smoother = (window: CurveWindow, frame: number) => number

export const createSmoother = (): Smoother => {
  const near = new Float64Array(2 * smoothingReach + 1)
  return (window, frame) => {
    const hz = window.f0At(frame)
    if (hz <= 0) {
      return 0
    }
    let count = 0
    near[count++] = hz
    for (let step = 1; step <= smoothingReach; step++) {
      const before = frame - step
      const value = before >= window.firstFrame ? window.f0At(before) : 0
      if (value <= 0) {
        break
      }
      near[count++] = value
    }
    for (let step = 1; step <= smoothingReach; step++) {
      const after = frame + step
      const value = after <= window.lastFrame ? window.f0At(after) : 0
      if (value <= 0) {
        break
      }
      near[count++] = value
    }
    // Insertion sort of at most five values, in place.
    for (let i = 1; i < count; i++) {
      const value = near[i] ?? 0
      let at = i
      while (at > 0 && (near[at - 1] ?? 0) > value) {
        near[at] = near[at - 1] ?? 0
        at--
      }
      near[at] = value
    }
    const middle = count >> 1
    return count % 2 === 1
      ? (near[middle] ?? hz)
      : ((near[middle - 1] ?? hz) + (near[middle] ?? hz)) / 2
  }
}

// What walking a curve meets, in frame order: the first point of a voiced
// run after nothing or a long gap, the first point after a short gap
// (bridged from the point before it), and each following point of a run.
// `hz` is the frame's drawn pitch, after smoothing.
export type CurveVisitor = Readonly<{
  runStart: (x: number, y: number, frame: number, hz: number) => void
  bridge: (x: number, y: number, frame: number, hz: number) => void
  point: (x: number, y: number, frame: number, hz: number) => void
}>

// Walks `window`'s frames as drawn across `spanFrames` frames of `area`.
export const walkCurve = (
  area: PlotArea,
  window: CurveWindow,
  spanFrames: number,
  smoother: Smoother,
  visitor: CurveVisitor,
): void => {
  let lastVoiced = Number.NaN
  for (let frame = window.firstFrame; frame <= window.lastFrame; frame++) {
    const hz = smoother(window, frame)
    if (hz <= 0) {
      continue
    }
    const x = xOfFrame(area, window.firstFrame, spanFrames, frame)
    const y = yOfHz(area, window.medianHz, hz)
    const gap = frame - lastVoiced - 1
    if (gap === 0) {
      visitor.point(x, y, frame, hz)
    } else if (gap <= bridgedGapFrames) {
      visitor.bridge(x, y, frame, hz)
    } else {
      visitor.runStart(x, y, frame, hz)
    }
    lastVoiced = frame
  }
}

export type Point = Readonly<{ x: number; y: number }>

// Where a curve's lines go, for tests and read-outs: each solid run as
// points, and each dashed bridge as its two ends.
export type CurveLayout = Readonly<{
  runs: ReadonlyArray<ReadonlyArray<Point>>
  bridges: ReadonlyArray<readonly [Point, Point]>
}>

export const layOutCurve = (
  area: PlotArea,
  window: CurveWindow,
  spanFrames: number,
): CurveLayout => {
  const runs: Array<Array<Point>> = []
  const bridges: Array<readonly [Point, Point]> = []
  let previous: Point = { x: 0, y: 0 }
  const startRun = (x: number, y: number): void => {
    previous = { x, y }
    runs.push([previous])
  }
  walkCurve(area, window, spanFrames, createSmoother(), {
    runStart: startRun,
    bridge: (x, y) => {
      bridges.push([previous, { x, y }])
      startRun(x, y)
    },
    point: (x, y) => {
      previous = { x, y }
      runs.at(-1)?.push(previous)
    },
  })
  return { runs, bridges }
}

// How a curve is stroked: its width, its colours, and which colour each
// frame's line takes, from its frame and drawn pitch.
export type Pen = Readonly<{
  width: number
  colours: ReadonlyArray<string>
  colourAt: (frame: number, hz: number) => number
}>

export const onePen = (width: number, colour: string): Pen => ({
  width,
  colours: [colour],
  colourAt: () => 0,
})

// The parts of a Path2D and a canvas context the stroker uses, so tests
// can stand them in.
export type CurvePath = Pick<Path2D, 'moveTo' | 'lineTo'>
export type StrokeTarget<Path> = {
  lineWidth: number
  lineJoin: CanvasLineJoin
  lineCap: CanvasLineCap
  strokeStyle: string | CanvasGradient | CanvasPattern
  setLineDash: (segments: Array<number>) => void
  stroke: (path: Path) => void
}

export type CurveStroker<Path = Path2D> = (
  context: StrokeTarget<Path>,
  area: PlotArea,
  window: CurveWindow,
  spanFrames: number,
  pen: Pen,
) => void

// Strokes `window` across `spanFrames` frames of `area` with `pen`: each
// colour's solid lines as one path and its dashed lines over short gaps
// as another, so a paint strokes at most twice per colour however often
// the colour changes along the curve. A lone frame is a dot: a line of no
// length, which the round cap draws. It walks the frames without
// allocating, so it can run on every animation frame.
export const createCurveStrokerWith = <Path extends CurvePath>(
  makePath: () => Path,
): CurveStroker<Path> => {
  const smoother = createSmoother()
  let solid: Array<Path> = []
  let dashed: Array<Path> = []
  // Which colours' paths have anything in them this paint.
  const solidUsed: Array<boolean> = []
  const dashedUsed: Array<boolean> = []
  let pen: Pen = onePen(1, '')
  let lastX = 0
  let lastY = 0
  let lastColour = 0

  const startAt = (x: number, y: number, colour: number): void => {
    const path = solid[colour]
    solidUsed[colour] = true
    path?.moveTo(x, y)
    path?.lineTo(x, y)
    lastX = x
    lastY = y
    lastColour = colour
  }
  const visitor: CurveVisitor = {
    runStart: (x, y, frame, hz) => startAt(x, y, pen.colourAt(frame, hz)),
    bridge: (x, y, frame, hz) => {
      const colour = pen.colourAt(frame, hz)
      dashedUsed[colour] = true
      dashed[colour]?.moveTo(lastX, lastY)
      dashed[colour]?.lineTo(x, y)
      startAt(x, y, colour)
    },
    point: (x, y, frame, hz) => {
      const colour = pen.colourAt(frame, hz)
      const path = solid[colour]
      if (colour !== lastColour) {
        // A new colour carries on from the last point, so the line stays
        // joined.
        solidUsed[colour] = true
        path?.moveTo(lastX, lastY)
      }
      path?.lineTo(x, y)
      lastX = x
      lastY = y
      lastColour = colour
    },
  }

  return (context, area, window, spanFrames, withPen) => {
    pen = withPen
    solid = withPen.colours.map(makePath)
    dashed = withPen.colours.map(makePath)
    solidUsed.length = 0
    dashedUsed.length = 0
    walkCurve(area, window, spanFrames, smoother, visitor)
    context.lineWidth = withPen.width
    context.lineJoin = 'round'
    context.lineCap = 'round'
    withPen.colours.forEach((colour, i) => {
      context.strokeStyle = colour
      const line = solid[i]
      const dashes = dashed[i]
      if (line !== undefined && solidUsed[i] === true) {
        context.stroke(line)
      }
      if (dashes !== undefined && dashedUsed[i] === true) {
        context.setLineDash(dash)
        context.stroke(dashes)
        context.setLineDash(none)
      }
    })
  }
}

export const createCurveStroker = (): CurveStroker =>
  createCurveStrokerWith(() => new Path2D())

export type AxisColours = Readonly<{
  grid: string
  median: string
  label: string
}>

// Clears a `width` by `height` CSS-pixel context and paints the semitone
// axis: a line every 3 semitones, the median's darker, labels every 6.
// `beneath` paints on the cleared plot before the axis's lines.
export const paintAxis = (
  context: CanvasRenderingContext2D,
  size: Readonly<{ width: number; height: number }>,
  colours: AxisColours,
  beneath?: (area: PlotArea) => void,
): PlotArea => {
  const area = plotArea(size.width, size.height)
  context.clearRect(0, 0, size.width, size.height)
  beneath?.(area)

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
            ? `−${-semitones}`
            : '0',
        area.left - 8,
        y,
      )
    }
  }
  return area
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

// Sizes `canvas`'s bitmap for its CSS box at the device's pixel ratio and
// scales its context to CSS pixels: its CSS size, or null while it has
// none.
export const fitCanvas = (
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
): Readonly<{ width: number; height: number }> | null => {
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  if (width === 0 || height === 0) {
    return null
  }
  const pixelRatio = globalThis.devicePixelRatio || 1
  const backing = backingSize(width, height, pixelRatio)
  canvas.width = backing.width
  canvas.height = backing.height
  context.setTransform(
    backing.width / width,
    0,
    0,
    backing.height / height,
    0,
    0,
  )
  return { width, height }
}
