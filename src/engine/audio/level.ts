// Levels in dBFS, as SwiftF0 measures them: exact zeros at -140 dBFS.

export const peakOf = (samples: Float32Array): number => {
  let peak = 0
  for (const sample of samples) {
    peak = Math.max(peak, Math.abs(sample))
  }
  return peak
}

export const toDb = (amplitude: number): number =>
  20 * Math.log10(Math.max(amplitude, 1e-7))
