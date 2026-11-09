import { Stream } from 'effect'

import type { LiveFrames } from '../../services/tracker'
import type { TakeCurve } from '../take/take'

// A curve played back as the tracker finds it during a take, for the
// library's live entries: the frames each 20 ms batch completes, 1.25 at
// a time, in real time, then the end of the take.

const batchMillis = 20

export const replayLive = (curve: TakeCurve): Stream.Stream<LiveFrames> => {
  const framesPerBatch = (curve.frameHz * batchMillis) / 1000
  const batches = Math.ceil(curve.f0Hz.length / framesPerBatch)
  return Stream.tick(`${batchMillis} millis`).pipe(
    Stream.take(batches),
    Stream.map((_, batch) => {
      const firstFrame = Math.floor(batch * framesPerBatch)
      const end = Math.min(
        curve.f0Hz.length,
        Math.floor((batch + 1) * framesPerBatch),
      )
      return {
        firstFrame,
        f0Hz: Float32Array.from(curve.f0Hz.slice(firstFrame, end)),
      }
    }),
  )
}
