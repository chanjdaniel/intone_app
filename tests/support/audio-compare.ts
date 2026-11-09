// Compares audio a capture path delivered with the audio it was given:
// where the source landed in the capture, at what gain, and how much else
// came with it. Plain maths on typed arrays, for the fake-microphone tests
// (docs/fake-microphone.md).

const taps = 32

const blackman = (w: number): number =>
  w <= 0 || w >= 1
    ? 0
    : 0.42 - 0.5 * Math.cos(2 * Math.PI * w) + 0.08 * Math.cos(4 * Math.PI * w)

// The Blackman-windowed sinc's weight for a sample `distance` samples from
// the instant read, band-limited to `cutoff` of the source's Nyquist
// frequency.
const weight = (distance: number, cutoff: number, reach: number): number => {
  const x = distance * cutoff
  const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)
  return cutoff * sinc * blackman(0.5 + distance / (2 * reach))
}

// The source, as the capture would hold it if it passed unaltered with
// the source's sample 0 at `delaySeconds` into the capture: its samples in
// [from, to) of a capture `length` long, zero elsewhere.
export const sourceAsCaptured = (
  source: Float32Array,
  sourceRate: number,
  captureRate: number,
  delaySeconds: number,
  length: number,
  from = 0,
  to = length,
): Float64Array => {
  const cutoff = Math.min(1, captureRate / sourceRate)
  const reach = Math.ceil(taps / cutoff)
  const result = new Float64Array(length)
  // At one rate every sample sits the same fraction from the source's, so
  // one set of weights serves them all.
  const fraction =
    sourceRate === captureRate
      ? -delaySeconds * sourceRate - Math.floor(-delaySeconds * sourceRate)
      : Number.NaN
  const fixed = Number.isNaN(fraction)
    ? null
    : Float64Array.from({ length: 2 * reach }, (_, j) =>
        weight(fraction - (j - reach + 1), cutoff, reach),
      )
  for (let i = from; i < to; i++) {
    const position = (i / captureRate - delaySeconds) * sourceRate
    const centre = Math.floor(position)
    let sum = 0
    for (let j = 0; j < 2 * reach; j++) {
      const k = centre - reach + 1 + j
      if (k < 0 || k >= source.length) {
        continue
      }
      sum +=
        (source[k] ?? 0) * (fixed?.[j] ?? weight(position - k, cutoff, reach))
    }
    result[i] = sum
  }
  return result
}

const firstAbove = (signal: ArrayLike<number>, level: number): number => {
  for (let i = 0; i < signal.length; i++) {
    if (Math.abs(signal[i] ?? 0) > level) {
      return i
    }
  }
  return -1
}

const peakOf = (signal: ArrayLike<number>): number => {
  let peak = 0
  for (let i = 0; i < signal.length; i++) {
    peak = Math.max(peak, Math.abs(signal[i] ?? 0))
  }
  return peak
}

type Fit = Readonly<{ gain: number; snrDb: number }>

// Least-squares gain of the capture against the expected audio over
// [from, to), and what is left over against the signal, in decibels.
const fit = (
  capture: Float32Array,
  expected: Float64Array,
  from: number,
  to: number,
): Fit => {
  let cross = 0
  let power = 0
  for (let i = from; i < to; i++) {
    cross += (capture[i] ?? 0) * (expected[i] ?? 0)
    power += (expected[i] ?? 0) ** 2
  }
  const gain = power === 0 ? 0 : cross / power
  let residual = 0
  for (let i = from; i < to; i++) {
    residual += ((capture[i] ?? 0) - gain * (expected[i] ?? 0)) ** 2
  }
  return {
    gain,
    snrDb:
      residual === 0
        ? Number.POSITIVE_INFINITY
        : 10 * Math.log10((gain * gain * power) / residual),
  }
}

export type Comparison = Readonly<{
  // Where the source's first sample landed, in seconds from the capture's
  // first sample: negative when the capture lost the source's start.
  delaySeconds: number
  gain: number
  // Signal against everything else over the source's sounding stretch:
  // quantisation, resampling and any processing.
  snrDb: number
  // The largest difference from the source at the nearest whole sample,
  // with no gain or resampling: 0 when the samples arrived unchanged.
  maxDifference: number
}>

// Finds the source in the capture: by onset to the nearest few samples,
// then by golden-section search for the fractional delay that leaves the
// least behind. Null when nothing arrived.
export const compareWithSource = (
  capture: Float32Array,
  captureRate: number,
  source: Float32Array,
  sourceRate: number,
): Comparison | null => {
  const sourcePeak = peakOf(source)
  const capturePeak = peakOf(capture)
  if (capturePeak < sourcePeak * 0.01) {
    return null
  }
  const sourceOnset = firstAbove(source, sourcePeak * 0.05) / sourceRate
  const captureOnset = firstAbove(capture, capturePeak * 0.05) / captureRate
  const roughDelay = captureOnset - sourceOnset
  const sourceEnd = (source.length - 1) / sourceRate
  const from = Math.max(0, Math.ceil((roughDelay + sourceOnset) * captureRate))
  const to = Math.min(
    capture.length,
    Math.floor((roughDelay + sourceEnd) * captureRate),
  )
  const residualAt = (delay: number): number =>
    -fit(
      capture,
      sourceAsCaptured(
        source,
        sourceRate,
        captureRate,
        delay,
        capture.length,
        from,
        to,
      ),
      from,
      to,
    ).snrDb

  // Golden-section search over three capture samples either way.
  const ratio = (Math.sqrt(5) - 1) / 2
  let low = roughDelay - 3 / captureRate
  let high = roughDelay + 3 / captureRate
  let left = high - ratio * (high - low)
  let right = low + ratio * (high - low)
  let leftValue = residualAt(left)
  let rightValue = residualAt(right)
  while (high - low > 0.005 / captureRate) {
    if (leftValue < rightValue) {
      high = right
      right = left
      rightValue = leftValue
      left = high - ratio * (high - low)
      leftValue = residualAt(left)
    } else {
      low = left
      left = right
      leftValue = rightValue
      right = low + ratio * (high - low)
      rightValue = residualAt(right)
    }
  }
  const delaySeconds = (low + high) / 2
  const best = fit(
    capture,
    sourceAsCaptured(
      source,
      sourceRate,
      captureRate,
      delaySeconds,
      capture.length,
      from,
      to,
    ),
    from,
    to,
  )

  let maxDifference = Number.POSITIVE_INFINITY
  if (captureRate === sourceRate) {
    const shift = Math.round(delaySeconds * captureRate)
    maxDifference = 0
    for (let i = 0; i < capture.length; i++) {
      const expected = source[i - shift] ?? 0
      maxDifference = Math.max(
        maxDifference,
        Math.abs((capture[i] ?? 0) - expected),
      )
    }
  }
  return { delaySeconds, gain: best.gain, snrDb: best.snrDb, maxDifference }
}
