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
// matched to the source within 15 ms of where the last one sat, or, when
// none matches there for sure, within 60 ms, so a capture path that drops or adds a
// stretch of samples shows as a slip rather than as noise over everything
// after it. A loaded machine's fake microphone adds up to four 10 ms
// buffers at once (docs/fake-microphone.md).
const segmentSeconds = 0.02
const followSeconds = 0.015
const widerFollowSeconds = 0.06
// A segment this far below the capture's peak power is too quiet to place.
const quietSegment = 1e-4
// A segment that matches the source no better than this at any lag, about
// 17 dB of signal over the rest, holds a slip or audio the path changed:
// it places nothing.
const matched = 0.99
// A segment that matches this well, 40 dB of signal over the rest, sits at
// the source's own lag; one that matches less well near the last lag may
// be the voice a pitch period off, which a steady vowel matches to 0.99,
// with the source itself a slip of more than 15 ms away.
const sure = 0.9999

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
  const quiet = quietSegment * peakOf(capture) ** 2 * segment
  const bestLags: Array<number> = []
  const placed: Array<Placed> = []
  // The lag within `reach` of `around` that matches the segment best.
  const search = (
    from: number,
    energy: number,
    around: number,
    reach: number,
  ) => {
    let best = Number.NEGATIVE_INFINITY
    let bestLag = around
    for (
      let candidate = around - reach;
      candidate <= around + reach;
      candidate++
    ) {
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
    return { best, bestLag }
  }
  let lag = startLag
  for (let from = 0; from + segment <= capture.length; from += segment) {
    let energy = 0
    for (let i = from; i < from + segment; i++) {
      energy += (capture[i] ?? 0) ** 2
    }
    if (energy < quiet) {
      continue
    }
    const near = search(
      from,
      energy,
      lag,
      Math.round(followSeconds * captureRate),
    )
    const found =
      near.best >= sure
        ? near
        : search(
            from,
            energy,
            lag,
            Math.round(widerFollowSeconds * captureRate),
          )
    bestLags.push(found.bestLag)
    if (found.best >= matched) {
      placed.push({ from, lag: found.bestLag })
      lag = found.bestLag
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
    // A new lag holds only if the next segment placed agrees, or has moved
    // on from the last lag too, as it has between two slips close together:
    // one segment alone at its own lag between two at the last one's
    // straddles a slip, half at each side.
    const next = placed[index + 1]
    if (
      last === undefined ||
      (next !== undefined &&
        (near(next.lag, segmentLag) || !near(next.lag, last.lag)))
    ) {
      stretches.push({ lag: segmentLag, from, to: from + segment })
    }
  })
  return {
    stretches: spliced(capture, expected, stretches, segment),
    bestLags,
    placed: placed.length,
  }
}

// Each pair of stretches met at the splice: the one sample at which the
// capture stops following the source at the earlier lag, and, past the
// samples a slip added, follows it at the later one. It lies in the last
// segment placed at the earlier lag, the first placed at the later one, or
// anywhere between them, so it is found by the least difference from the
// source either side of it over all of that.
const spliced = (
  capture: Float32Array,
  expected: Float64Array,
  stretches: ReadonlyArray<Stretch>,
  segment: number,
): ReadonlyArray<Stretch> => {
  const result = stretches.map(stretch => ({ ...stretch }))
  for (let index = 1; index < result.length; index++) {
    const before = result[index - 1]
    const after = result[index]
    if (before === undefined || after === undefined) {
      continue
    }
    const added = Math.max(0, after.lag - before.lag)
    const from = Math.max(before.from, before.to - segment)
    const to = Math.min(after.to, after.from + segment)
    // Running sums of the squared difference at each lag from `from`.
    const differences = (lag: number) => {
      const sums = new Float64Array(to - from + 1)
      for (let i = from; i < to; i++) {
        const difference = (capture[i] ?? 0) - (expected[i - lag] ?? 0)
        sums[i - from + 1] = (sums[i - from] ?? 0) + difference * difference
      }
      return sums
    }
    const earlier = differences(before.lag)
    const later = differences(after.lag)
    let best = Number.POSITIVE_INFINITY
    let splice = from
    for (let at = from; at + added <= to; at++) {
      const left = (earlier[at - from] ?? 0) - (earlier[0] ?? 0)
      const right = (later[to - from] ?? 0) - (later[at + added - from] ?? 0)
      if (left + right < best) {
        best = left + right
        splice = at
      }
    }
    result[index - 1] = { ...before, to: splice }
    result[index] = { ...after, from: splice + added }
  }
  return result
}

// Each stretch gives up the resampler's reach either side of a splice, so
// the delay and the fit read only audio clear of it.
const slipGuardSeconds = 0.002

const clearOfSlips = (
  stretches: ReadonlyArray<Stretch>,
  captureRate: number,
): ReadonlyArray<Stretch> => {
  const cut = Math.round(slipGuardSeconds * captureRate)
  return stretches.map((stretch, index) => {
    const from = index > 0 ? stretch.from + cut : stretch.from
    const to = index < stretches.length - 1 ? stretch.to - cut : stretch.to
    return { ...stretch, from, to: Math.max(from, to) }
  })
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
  const fitted = clearOfSlips(stretches, captureRate)
  const delays = fitted.map(range =>
    fractionalDelay(
      capture,
      captureRate,
      source,
      sourceRate,
      range.lag / captureRate,
      range,
    ),
  )
  const expected = new Float64Array(capture.length)
  fitted.forEach((range, index) => {
    expected.set(
      sourceAsCaptured(
        source,
        sourceRate,
        captureRate,
        delays[index] ?? 0,
        capture.length,
        range.from,
        range.to,
      ).subarray(range.from, range.to),
      range.from,
    )
  })
  const best = fit(capture, expected, fitted)
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
