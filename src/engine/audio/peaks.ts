// A clip's waveform, as the line editor draws it: the loudest sample in
// each 10 ms, one byte each, on a dB scale from -60 dBFS (0) to 0 dBFS
// (255), so a quiet recording still shows its shape and the editor's
// finest step, 10 ms, is one bar.

export const peaksPerSecond = 100

export const quietestPeakDb = -60

export const waveformPeaks = (
  samples: Float32Array,
  sampleRate: number,
): Uint8Array => {
  const binSamples = sampleRate / peaksPerSecond
  const bins = Math.ceil(samples.length / binSamples)
  const peaks = new Uint8Array(bins)
  for (let bin = 0; bin < bins; bin += 1) {
    const from = Math.floor(bin * binSamples)
    const to = Math.min(samples.length, Math.floor((bin + 1) * binSamples))
    let peak = 0
    for (let n = from; n < to; n += 1) {
      peak = Math.max(peak, Math.abs(samples[n] ?? 0))
    }
    const db = 20 * Math.log10(Math.max(peak, 1e-7))
    peaks[bin] = Math.round(
      255 * Math.min(1, Math.max(0, (db - quietestPeakDb) / -quietestPeakDb)),
    )
  }
  return peaks
}

// A peak's height, 0 to 1.
export const peakHeight = (peak: number): number => peak / 255
