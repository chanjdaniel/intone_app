// A streaming resampler, down from the capture's rate to the tracker's
// 16 kHz: a windowed-sinc low-pass evaluated at each output instant, so it
// works for any pair of rates (48 kHz, 44.1 kHz, ...). It is zero-phase:
// output sample m sits at exactly m / toRate seconds, the same instant as
// input sample m * fromRate / toRate, so resampling shifts no timing.

// Half the kernel's length, in input samples at the higher rate, scaled
// by the rate ratio, so the filter's transition band stays the same width
// in Hz whatever the input rate.
const halfLengthAtOutputRate = 40
// The filter's half-gain point, as a fraction of the output's Nyquist:
// at 16 kHz it passes up to about 6.5 kHz whole and stops 9 kHz and above,
// far above any voice's F0.
const cutoffFraction = 0.9
// Kernel phases tabulated between two input samples, interpolated
// linearly between.
const phases = 512

const blackman = (x: number): number =>
  0.42 + 0.5 * Math.cos(Math.PI * x) + 0.08 * Math.cos(2 * Math.PI * x)

const sinc = (x: number): number =>
  x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)

export type Resampler = Readonly<{
  // The output for `input`, which follows everything pushed before; the
  // last few output samples wait for the input after them.
  push: (input: Float32Array) => Float32Array
  // The output still waiting, as if silence followed: after it, the
  // output holds ceil(inputLength * toRate / fromRate) samples in all.
  flush: () => Float32Array
}>

export const createResampler = (
  fromRate: number,
  toRate: number,
): Resampler => {
  if (!(fromRate > 0 && toRate > 0)) {
    throw new RangeError('sample rates must be positive')
  }
  if (toRate > fromRate) {
    throw new RangeError('the resampler only lowers the rate')
  }
  if (toRate === fromRate) {
    return { push: input => input.slice(), flush: () => new Float32Array(0) }
  }

  const step = fromRate / toRate
  const half = Math.ceil(halfLengthAtOutputRate * step)
  const taps = 2 * half
  // Cycles per input sample.
  const cutoff = (cutoffFraction * 0.5) / step
  // Row p holds the taps for an output instant p / phases of an input
  // sample after the tap nearest below it; row `phases` closes the range.
  const table = new Float32Array((phases + 1) * taps)
  for (let p = 0; p <= phases; p++) {
    const fraction = p / phases
    let sum = 0
    for (let j = 0; j < taps; j++) {
      const distance = fraction + half - 1 - j
      const value =
        2 * cutoff * sinc(2 * cutoff * distance) * blackman(distance / half)
      table[p * taps + j] = value
      sum += value
    }
    for (let j = 0; j < taps; j++) {
      table[p * taps + j] = (table[p * taps + j] ?? 0) / sum
    }
  }

  // Input from index `base` on, the part later outputs still need.
  let pending = new Float32Array(0)
  let base = 0
  let inputLength = 0
  let emitted = 0

  const sampleAt = (index: number): number =>
    index < base ? 0 : (pending[index - base] ?? 0)

  const outputAt = (m: number): number => {
    const t = m * step
    const below = Math.floor(t)
    const position = (t - below) * phases
    const p = Math.min(Math.floor(position), phases - 1)
    const blend = position - p
    const first = below - half + 1
    let value = 0
    for (let j = 0; j < taps; j++) {
      const tap =
        (table[p * taps + j] ?? 0) * (1 - blend) +
        (table[(p + 1) * taps + j] ?? 0) * blend
      value += tap * sampleAt(first + j)
    }
    return value
  }

  // Emits every output whose kernel lies inside `available` input
  // samples, then drops the input no later output reads.
  const emitUpTo = (available: number, limit: number): Float32Array => {
    const outputs: Array<number> = []
    while (emitted < limit && Math.floor(emitted * step) + half < available) {
      outputs.push(outputAt(emitted))
      emitted++
    }
    const keepFrom = Math.max(base, Math.floor(emitted * step) - half + 1)
    pending = pending.slice(keepFrom - base)
    base = keepFrom
    return Float32Array.from(outputs)
  }

  return {
    push: input => {
      const joined = new Float32Array(pending.length + input.length)
      joined.set(pending)
      joined.set(input, pending.length)
      pending = joined
      inputLength += input.length
      return emitUpTo(base + pending.length, Number.POSITIVE_INFINITY)
    },
    flush: () =>
      emitUpTo(Number.POSITIVE_INFINITY, Math.ceil(inputLength / step)),
  }
}

// Resamples a whole recording at once.
export const resample = (
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array => {
  const resampler = createResampler(fromRate, toRate)
  const head = resampler.push(input)
  const tail = resampler.flush()
  const output = new Float32Array(head.length + tail.length)
  output.set(head)
  output.set(tail, head.length)
  return output
}
