import type { LiveFrames } from '../pitch/live'
import { createOnsetFinder } from '../pitch/onset'
import type { CurveWindow } from './curve'

// The learner's curve as it is drawn during a take: frames come in from
// the tracker as it finds them and go into a ring buffer, and each
// animation frame paints from there. The curve starts at the voice's
// onset, on the semitone axis of the finished curve, around a running
// median of the voiced frames so far that settles towards each new
// median rather than jumping to it. When the take ends the curve snaps to
// its finished window: the exact median, from the onset to the last
// voiced frame, as the finished curve is drawn.

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
      return {
        f0At,
        firstFrame,
        lastFrame: finished ? Math.max(firstFrame, newestVoiced) : framesIn - 1,
        medianHz: 2 ** drawnLog2,
      }
    },

    framesIn: () => framesIn,
    newestVoicedFrame: () => newestVoiced,
  }
}

// A finished curve as a live one that has ended: its frames from the
// first, snapped to its finished window.
export const finishedLiveCurve = (f0Hz: Float32Array): LiveCurve => {
  const curve = createLiveCurve(Math.max(1, f0Hz.length))
  curve.append({ firstFrame: 0, f0Hz })
  curve.finish()
  return curve
}

// A curve shown in a window it is given, as a live one that has ended:
// a take lined up with the native, drawn across the native's own window.
export const windowCurve = (window: CurveWindow): LiveCurve => {
  let newestVoiced = -1
  for (let frame = window.firstFrame; frame <= window.lastFrame; frame++) {
    if (window.f0At(frame) > 0) {
      newestVoiced = frame
    }
  }
  let changed = true
  return {
    append: () => undefined,
    finish: () => undefined,
    advance: () => {
      const wasChanged = changed
      changed = false
      return wasChanged
    },
    window: () => window,
    framesIn: () => window.lastFrame + 1,
    newestVoicedFrame: () => newestVoiced,
  }
}
