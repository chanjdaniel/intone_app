// One recording's tracker output (CONTEXT.md, Curve): pitch, confidence
// and level per 16 ms frame, and the onset. Kept raw, so a take can be
// scored again when the method changes.
export type Curve = Readonly<{
  // SwiftF0's 16 ms hop.
  frameHz: number
  // 0 where the frame is unvoiced or below the confidence gate.
  f0Hz: Float32Array
  // 0 to 1.
  confidence: Float32Array
  // The frame's RMS in dBFS, over the 32 ms centred on it.
  levelDb: Float32Array
  // The first frame of the voice; the curve is drawn and compared from
  // here, so starting late shifts nothing.
  onsetFrame: number
}>

// Semitones from `referenceHz`: 12 per octave.
export const semitonesFrom = (referenceHz: number, hz: number): number =>
  12 * Math.log2(hz / referenceHz)

// The median of the voiced frames' F0, in Hz: the speaker's own typical
// pitch, around which a curve is drawn and compared. NaN with no voiced
// frame.
export const medianVoicedHz = (f0Hz: Float32Array): number => {
  const voiced = f0Hz.filter(hz => hz > 0).sort()
  if (voiced.length === 0) {
    return Number.NaN
  }
  const middle = voiced.length >> 1
  return voiced.length % 2 === 1
    ? (voiced[middle] ?? Number.NaN)
    : ((voiced[middle - 1] ?? 0) + (voiced[middle] ?? 0)) / 2
}
