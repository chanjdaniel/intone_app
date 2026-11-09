// Compares audio a capture path delivered with the audio it was given:
// where the source landed in the capture, whether it slipped, at what
// gain, and how much else came with it. Plain maths on typed arrays, for the fake-microphone tests
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

// The samples low-passed at `cutoffHz` by a 25 ms Blackman-windowed sinc,
// for comparing a path that cuts the top of a source's band below it.
export const lowPass = (
  samples: Float32Array,
  sampleRate: number,
  cutoffHz: number,
): Float32Array => {
  const reach = Math.round(0.0125 * sampleRate)
  const cutoff = (2 * cutoffHz) / sampleRate
  const kernel = Float64Array.from({ length: 2 * reach + 1 }, (_, j) =>
    weight(j - reach, cutoff, reach + 1),
  )
  return Float32Array.from(samples, (_, i) => {
    let sum = 0
    for (let j = 0; j < kernel.length; j++) {
      sum += (samples[i + j - reach] ?? 0) * (kernel[j] ?? 0)
    }
    return sum
  })
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

type Range = Readonly<{ from: number; to: number }>

type Fit = Readonly<{ gain: number; snrDb: number }>

// Least-squares gain of the capture against the expected audio over the
// ranges, and what is left over against the signal, in decibels.
const fit = (
  capture: Float32Array,
  expected: Float64Array,
  ranges: ReadonlyArray<Range>,
): Fit => {
  let cross = 0
  let power = 0
  for (const { from, to } of ranges) {
    for (let i = from; i < to; i++) {
      cross += (capture[i] ?? 0) * (expected[i] ?? 0)
      power += (expected[i] ?? 0) ** 2
    }
  }
  const gain = power === 0 ? 0 : cross / power
  let residual = 0
  for (const { from, to } of ranges) {
    for (let i = from; i < to; i++) {
      residual += ((capture[i] ?? 0) - gain * (expected[i] ?? 0)) ** 2
    }
  }
  return {
    gain,
    snrDb:
      residual === 0
        ? Number.POSITIVE_INFINITY
        : 10 * Math.log10((gain * gain * power) / residual),
  }
}

// The fractional delay near `roughDelay`, within a sample and a half
// either way, at which the source leaves the least behind over [from, to),
// by golden-section search.
const fractionalDelay = (
  capture: Float32Array,
  captureRate: number,
  source: Float32Array,
  sourceRate: number,
  roughDelay: number,
  range: Range,
): number => {
  const residualAt = (delay: number): number =>
    -fit(
      capture,
      sourceAsCaptured(
        source,
        sourceRate,
        captureRate,
        delay,
        capture.length,
        range.from,
        range.to,
      ),
      [range],
    ).snrDb
  const ratio = (Math.sqrt(5) - 1) / 2
  let low = roughDelay - 1.5 / captureRate
  let high = roughDelay + 1.5 / captureRate
  let left = high - ratio * (high - low)
  let right = low + ratio * (high - low)
  let leftValue = residualAt(left)
  let rightValue = residualAt(right)
  while (high - low > 1e-4 / captureRate) {
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
  return (low + high) / 2
}

// The source is followed through the capture in 20 ms segments, each
// matched to the source within 15 ms of where the last one sat, so a
// capture path that drops or adds a stretch of samples shows as a slip
// rather than as noise over everything after it.
const segmentSeconds = 0.02
const followSeconds = 0.015
// A segment this far below the capture's peak power is too quiet to place.
const quietSegment = 1e-4
// A segment that matches the source no better than this at any lag, about
// 17 dB of signal over the rest, holds a slip or audio the path changed:
// it places nothing.
const matched = 0.99

export type Slip = Readonly<{
  // Where in the capture the source was first found at its new delay.
  atSeconds: number
  // How much later the source sits from there on: positive when samples
  // were added, negative when some were lost.
  bySeconds: number
}>

export type Comparison = Readonly<{
  // Where the source's first sample landed, in seconds from the capture's
  // first sample, before any slip: negative when the capture lost the
  // source's start.
  delaySeconds: number
  slips: ReadonlyArray<Slip>
  gain: number
  // Signal against everything else over the stretches between slips, each
  // at its own delay: quantisation, resampling and any processing. A
  // capture the path changed throughout is fitted whole, at one delay.
  snrDb: number
  // The largest difference from the source at the first delay's nearest
  // whole sample, with no gain or resampling, over the whole capture: 0
  // when the samples arrived unchanged.
  maxDifference: number
}>

type Stretch = Range & Readonly<{ lag: number }>

type Followed = Readonly<{
  stretches: ReadonlyArray<Stretch>
  // Each segment loud enough to place, at its best lag, matched or not.
  bestLags: ReadonlyArray<number>
  // How many of them matched.
  placed: number
}>

type Placed = Readonly<{ from: number; lag: number }>

// The stretches of the capture over which the source sits at one whole
// lag (capture samples), found segment by segment from `startLag`.
const followSource = (
  capture: Float32Array,
  expected: Float64Array,
  captureRate: number,
  startLag: number,
): Followed => {
  const segment = Math.round(segmentSeconds * captureRate)
  const reach = Math.round(followSeconds * captureRate)
  const quiet = quietSegment * peakOf(capture) ** 2 * segment
  const bestLags: Array<number> = []
  const placed: Array<Placed> = []
  let lag = startLag
  for (let from = 0; from + segment <= capture.length; from += segment) {
    let energy = 0
    for (let i = from; i < from + segment; i++) {
      energy += (capture[i] ?? 0) ** 2
    }
    if (energy < quiet) {
      continue
    }
    let best = Number.NEGATIVE_INFINITY
    let bestLag = lag
    for (let candidate = lag - reach; candidate <= lag + reach; candidate++) {
      let cross = 0
      let power = 0
      for (let i = from; i < from + segment; i++) {
        const value = expected[i - candidate] ?? 0
        cross += (capture[i] ?? 0) * value
        power += value * value
      }
      const correlation = power === 0 ? 0 : cross / Math.sqrt(power * energy)
      if (correlation > best) {
        best = correlation
        bestLag = candidate
      }
    }
    bestLags.push(bestLag)
    if (best >= matched) {
      placed.push({ from, lag: bestLag })
      lag = bestLag
    }
  }

  // A sample either way is the resampler's fraction, not a slip.
  const near = (a: number, b: number) => Math.abs(a - b) <= 1
  const stretches: Array<Stretch> = []
  placed.forEach(({ from, lag: segmentLag }, index) => {
    const last = stretches.at(-1)
    if (last !== undefined && near(segmentLag, last.lag)) {
      stretches[stretches.length - 1] = { ...last, to: from + segment }
      return
    }
    // A new lag holds only if the next segment placed agrees: one segment
    // alone at its own lag straddles a slip, half at each side.
    const next = placed[index + 1]
    if (
      last === undefined ||
      (next !== undefined && near(next.lag, segmentLag))
    ) {
      stretches.push({ lag: segmentLag, from, to: from + segment })
    }
  })
  return { stretches, bestLags, placed: placed.length }
}

// Finds the source in the capture: by onset to the nearest few samples,
// then segment by segment for any slip, then by golden-section search for
// each stretch's fractional delay. Null when nothing arrived.
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
  // The source at the capture's rate with its first sample at the
  // capture's first, which each segment is matched against.
  const expectedLength = Math.ceil((source.length / sourceRate) * captureRate)
  const resampled = sourceAsCaptured(
    source,
    sourceRate,
    captureRate,
    0,
    expectedLength,
  )
  const roughLag = Math.round((captureOnset - sourceOnset) * captureRate)
  const followed = followSource(capture, resampled, captureRate, roughLag)
  // Most of it unplaced: the path changed the audio throughout, and there
  // is no slip to speak of, only the whole sounding stretch, at the lag
  // most segments came closest at.
  const sortedLags = [...followed.bestLags].sort((a, b) => a - b)
  const wholeLag = sortedLags[Math.floor(sortedLags.length / 2)] ?? roughLag
  const stretches =
    followed.placed * 2 >= followed.bestLags.length
      ? followed.stretches
      : [
          {
            lag: wholeLag,
            from: Math.max(0, wholeLag),
            to: Math.min(capture.length, wholeLag + expectedLength),
          },
        ]
  const delays = stretches.map(stretch =>
    fractionalDelay(
      capture,
      captureRate,
      source,
      sourceRate,
      stretch.lag / captureRate,
      stretch,
    ),
  )
  const expected = new Float64Array(capture.length)
  stretches.forEach((stretch, index) => {
    expected.set(
      sourceAsCaptured(
        source,
        sourceRate,
        captureRate,
        delays[index] ?? 0,
        capture.length,
        stretch.from,
        stretch.to,
      ).subarray(stretch.from, stretch.to),
      stretch.from,
    )
  })
  const best = fit(capture, expected, stretches)
  const delaySeconds = delays[0] ?? 0
  const slips = stretches.slice(1).map((stretch, index) => ({
    atSeconds: stretch.from / captureRate,
    bySeconds: (delays[index + 1] ?? 0) - (delays[index] ?? 0),
  }))

  let maxDifference = Number.POSITIVE_INFINITY
  if (captureRate === sourceRate) {
    const shift = Math.round(delaySeconds * captureRate)
    maxDifference = 0
    for (let i = 0; i < capture.length; i++) {
      const expectedSample = source[i - shift] ?? 0
      maxDifference = Math.max(
        maxDifference,
        Math.abs((capture[i] ?? 0) - expectedSample),
      )
    }
    // The samples arrived unchanged, a whole number of samples late: the
    // search's fractional delay and its fit are only close to that.
    if (maxDifference === 0) {
      return {
        delaySeconds: shift / captureRate,
        slips: [],
        gain: 1,
        snrDb: Number.POSITIVE_INFINITY,
        maxDifference,
      }
    }
  }
  return {
    delaySeconds,
    slips,
    gain: best.gain,
    snrDb: best.snrDb,
    maxDifference,
  }
}
