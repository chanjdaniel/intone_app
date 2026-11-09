import type { TakeCurve } from './take'

// A short curve for the app's own tests to put in a Model; nothing in the
// app imports it.
export const sampleCurve: TakeCurve = {
  frameHz: 62.5,
  f0Hz: [0, 200, 210, 220, 200, 180, 170, 0],
  confidence: [0.1, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.1],
  levelDb: [-80, -20, -20, -20, -20, -20, -20, -80],
  onsetFrame: 1,
}
