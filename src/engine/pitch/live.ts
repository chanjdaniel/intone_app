import { confidenceGate } from '../../score/constants'
import { toDb } from '../audio/level'
import {
  type SwiftF0Inference,
  frameCount,
  isSilentFrame,
  leftFrames,
  lookaheadFrames,
  swiftF0Hop,
  swiftF0MaxHz,
  swiftF0MinHz,
  windowFrames,
} from './swift-f0'
import { quietTakeGainDb } from './take'

// SwiftF0 during a take, for the live curve: 16 kHz audio in as it comes,
// and each frame out, gated, as soon as the model can see the 10 frames
// after it (176 ms with the frame's own 16 ms). Each frame is tracked
// once, in a window with SwiftF0's context either side, so a loud take's
// live frames are the frames the whole take gives. A quiet take is
// scaled by its peak so far, as `analyseTake` scales by the whole take's
// peak, so its live frames may differ a little from its final curve.
// The last 10 frames of a take come when it ends, read to its end, as
// the whole take reads them.

// Frames newly tracked: `f0Hz[i]` is frame `firstFrame + i` of the take,
// 0 where unvoiced or below the confidence gate.
export type LiveFrames = Readonly<{ firstFrame: number; f0Hz: Float32Array }>

export type LiveTracker = Readonly<{
  // The take's next samples at 16 kHz: the frames they complete, or null.
  // Each push is awaited before the next.
  push: (samples: Float32Array) => Promise<LiveFrames | null>
  // The take has ended: its frames still waiting for lookahead, read to
  // its end, or null when there are none.
  flush: () => Promise<LiveFrames | null>
}>

// Room for the take's audio, grown by doubling: 4 s to begin with.
const initialSamples = 4 * 16_000

export const createLiveTracker = (infer: SwiftF0Inference): LiveTracker => {
  let audio = new Float32Array(initialSamples)
  let length = 0
  let peak = 0
  let emitted = 0

  const append = (samples: Float32Array): void => {
    if (length + samples.length > audio.length) {
      const grown = new Float32Array(
        Math.max(2 * audio.length, length + samples.length),
      )
      grown.set(audio.subarray(0, length))
      audio = grown
    }
    audio.set(samples, length)
    length += samples.length
    for (const sample of samples) {
      peak = Math.max(peak, Math.abs(sample))
    }
  }

  // Tracks frames `emitted` to `ready`, each window reaching `lookahead`
  // frames past its last, or to the end of the audio when `toEnd`.
  const track = async (ready: number, toEnd: boolean): Promise<LiveFrames> => {
    const firstFrame = emitted
    const f0Hz = new Float32Array(ready - firstFrame)
    const gain = 10 ** (quietTakeGainDb(toDb(peak)) / 20)
    for (let start = firstFrame; start < ready; start += windowFrames) {
      const end = Math.min(start + windowFrames, ready)
      const left = Math.max(0, start - leftFrames)
      const heard = audio.subarray(
        left * swiftF0Hop,
        toEnd && end === ready ? length : (end + lookaheadFrames) * swiftF0Hop,
      )
      const window = gain === 1 ? heard : heard.map(sample => sample * gain)
      const result = await infer(window, swiftF0MinHz, swiftF0MaxHz)
      for (let frame = start; frame < end; frame++) {
        const confident =
          (result.confidence[frame - left] ?? 0) >= confidenceGate &&
          !isSilentFrame(window, frame - left)
        f0Hz[frame - firstFrame] = confident
          ? (result.pitchHz[frame - left] ?? 0)
          : 0
      }
    }
    emitted = ready
    return { firstFrame, f0Hz }
  }

  return {
    push: async samples => {
      append(samples)
      const ready = Math.floor(length / swiftF0Hop) - lookaheadFrames
      return ready > emitted ? track(ready, false) : null
    },
    flush: async () => {
      const ready = length === 0 ? 0 : frameCount(length)
      return ready > emitted ? track(ready, true) : null
    },
  }
}
