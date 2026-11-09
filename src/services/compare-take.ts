import { alignedTakeF0 } from '../score/align'
import { type Recording, scoreWithAlignment } from '../score/score'
import type { Comparison } from './scorer'

// The score's maths, in a chunk of its own that the Scorer loads on the
// first take (./scorer.ts).
export const compareTake = (native: Recording, take: Recording): Comparison => {
  const { score, alignment } = scoreWithAlignment(native, take)
  return {
    score,
    alignedTakeF0:
      alignment === null
        ? null
        : alignedTakeF0(alignment, take.curve.f0Hz, native.curve.f0Hz.length),
  }
}
