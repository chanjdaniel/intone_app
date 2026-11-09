import type { LiveFrames } from '../pitch/live'
import { createOnsetFinder } from '../pitch/onset'
import { swiftF0FrameHz } from '../pitch/swift-f0'
import {
  type CurveColours,
  type CurveWindow,
  backingSize,
  paintAxis,
  strokeCurve,
} from './curve'

// The learner's curve as it is drawn during a take: frames come in from
// the tracker as it finds them and go into a ring buffer, and each
// animation frame paints from there. The curve starts at the voice's
// onset, on the semitone axis of the finished curve, around a running
// median of the voiced frames so far that settles towards each new
// median rather than jumping to it. When the take ends the curve snaps to
// its finished window: the exact median, from the onset to the last
// voiced frame, as the finished curve is drawn.

// The width shows at least this long from the onset, then squeezes to
// fit as the take goes on: about a short line's length, so a line's
// shape is not stretched while it is still being said.
export const shortestLiveSpanSeconds = 4
// The drawn median closes this fraction of its distance to the running
// median every this many ms, about 63% per 400 ms.
export const medianSettleMs = 400
// Closer than this, in semitones, the drawn median takes the running one.
const settledSemitones = 0.005

export type LiveCurve = Readonly<{
  // The tracker's next frames, which follow the last appended.
  append: (frames: LiveFrames) => void
  // The take is over: no frame follows, and the curve takes its finished
  // window.
  finish: () => void
  // Moves the drawn median on to `nowMs`; whether the curve looks
  // different from its last `window`.
  advance: (nowMs: number) => boolean
  // What to paint now, or null before the voice's onset.
  window: () => CurveWindow | null
  // How many frames have come, and the newest voiced one, or -1.
  framesIn: () => number
  newestVoicedFrame: () => number
}>

// `capacity` frames are kept: frames older than that are overwritten,
// and the median then counts only the first `capacity` voiced frames.
export const createLiveCurve = (capacity: number): LiveCurve => {
  const ring = new Float32Array(capacity)
  // The voiced frames' F0 so far, sorted, for the running median.
  const voiced = new Float32Array(capacity)
  let voicedCount = 0
  let framesIn = 0
  let newestVoiced = -1
  let onset: number | null = null
  const onsetFinder = createOnsetFinder()
  // The drawn median, as log2 of Hz, and the time it was moved to.
  let drawnLog2 = Number.NaN
  let movedAt = Number.NaN
  let finished = false
  let changed = false

  const insertVoiced = (hz: number): void => {
    if (voicedCount === capacity) {
      return
    }
    let at = voicedCount
    while (at > 0 && (voiced[at - 1] ?? 0) > hz) {
      voiced[at] = voiced[at - 1] ?? 0
      at--
    }
    voiced[at] = hz
    voicedCount++
  }

  const runningMedianHz = (): number => {
    const middle = voicedCount >> 1
    return voicedCount % 2 === 1
      ? (voiced[middle] ?? Number.NaN)
      : ((voiced[middle - 1] ?? 0) + (voiced[middle] ?? 0)) / 2
  }

  const f0At = (frame: number): number =>
    frame < framesIn - capacity || frame >= framesIn
      ? 0
      : (ring[frame % capacity] ?? 0)

  return {
    append: ({ firstFrame, f0Hz }) => {
      if (finished || firstFrame !== framesIn) {
        return
      }
      for (let i = 0; i < f0Hz.length; i++) {
        const hz = f0Hz[i] ?? 0
        ring[(firstFrame + i) % capacity] = hz
        if (hz > 0) {
          insertVoiced(hz)
          newestVoiced = firstFrame + i
        }
      }
      framesIn += f0Hz.length
      onset = onsetFinder.push(firstFrame, f0Hz)
      changed = f0Hz.length > 0
    },

    finish: () => {
      if (!finished) {
        finished = true
        drawnLog2 = Math.log2(runningMedianHz())
        changed = true
      }
    },

    advance: nowMs => {
      const wasChanged = changed
      changed = false
      if (onset === null || finished) {
        return wasChanged
      }
      const targetLog2 = Math.log2(runningMedianHz())
      if (Number.isNaN(drawnLog2)) {
        drawnLog2 = targetLog2
        movedAt = nowMs
        return true
      }
      const elapsed = Math.max(0, nowMs - movedAt)
      movedAt = nowMs
      const distance = targetLog2 - drawnLog2
      if (distance === 0) {
        return wasChanged
      }
      drawnLog2 =
        Math.abs(12 * distance) < settledSemitones
          ? targetLog2
          : drawnLog2 + distance * (1 - Math.exp(-elapsed / medianSettleMs))
      return true
    },

    window: () => {
      if (onset === null || Number.isNaN(drawnLog2)) {
        return null
      }
      const firstFrame = Math.max(onset, framesIn - capacity)
      if (finished) {
        const lastFrame = Math.max(firstFrame, newestVoiced)
        return {
          f0At,
          firstFrame,
          lastFrame,
          spanFrames: lastFrame - firstFrame,
          medianHz: 2 ** drawnLog2,
        }
      }
      const lastFrame = framesIn - 1
      return {
        f0At,
        firstFrame,
        lastFrame,
        spanFrames: Math.max(
          shortestLiveSpanSeconds * swiftF0FrameHz,
          lastFrame - firstFrame,
        ),
        medianHz: 2 ** drawnLog2,
      }
    },

    framesIn: () => framesIn,
    newestVoicedFrame: () => newestVoiced,
  }
}

// Paints `curve` as it is now over a `width` by `height` CSS-pixel
// context.
export const paintLiveCurve = (
  context: CanvasRenderingContext2D,
  curve: LiveCurve,
  size: Readonly<{ width: number; height: number }>,
  colours: CurveColours,
): void => {
  const area = paintAxis(context, size, colours)
  const window = curve.window()
  if (window !== null) {
    strokeCurve(context, area, window, colours.curve)
  }
}

export type LiveCurveDrawing = Readonly<{
  // Stops drawing; the canvas keeps its last picture.
  stop: () => void
}>

// Draws `curve` on `canvas` on each animation frame that changes it, at
// the canvas's size and the device's pixel ratio, until stopped.
// `colours` is read again when the canvas changes size; `painted` hears
// each paint.
export const drawLiveCurve = (
  canvas: HTMLCanvasElement,
  curve: LiveCurve,
  colours: () => CurveColours,
  painted: (curve: LiveCurve) => void,
): LiveCurveDrawing => {
  const context = canvas.getContext('2d')
  let resized = true
  let frameRequest = 0
  let currentColours = colours()
  const observer = new ResizeObserver(() => {
    resized = true
  })
  observer.observe(canvas)

  const onFrame = (nowMs: number): void => {
    frameRequest = requestAnimationFrame(onFrame)
    const moved = curve.advance(nowMs)
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (context === null || width === 0 || height === 0) {
      return
    }
    if (resized) {
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
      currentColours = colours()
    }
    if (resized || moved) {
      resized = false
      paintLiveCurve(context, curve, { width, height }, currentColours)
      painted(curve)
    }
  }
  frameRequest = requestAnimationFrame(onFrame)

  return {
    stop: () => {
      cancelAnimationFrame(frameRequest)
      observer.disconnect()
    },
  }
}
