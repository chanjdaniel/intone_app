// The voice's onset: the first frame of the first run of this many voiced
// frames, 48 ms, so one stray voiced frame does not start the curve.
export const onsetRunFrames = 3

export type OnsetFinder = Readonly<{
  // The next frames of a curve, `firstFrame` on, following the last
  // pushed: the onset frame once it is found, and from then on, or null.
  push: (firstFrame: number, f0Hz: Float32Array) => number | null
}>

export const createOnsetFinder = (): OnsetFinder => {
  let run = 0
  let onset: number | null = null
  return {
    push: (firstFrame, f0Hz) => {
      for (let i = 0; onset === null && i < f0Hz.length; i++) {
        run = (f0Hz[i] ?? 0) > 0 ? run + 1 : 0
        if (run === onsetRunFrames) {
          onset = firstFrame + i - onsetRunFrames + 1
        }
      }
      return onset
    },
  }
}
