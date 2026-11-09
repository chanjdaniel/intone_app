import { type Features, featureFrames } from './features'

// Lining up a take with the native, frame by frame, on what the two
// recordings sound like and never on their pitch (report section 3): a
// wrong accent must not be warped onto the right one.

// Pairs of frames that match, native and take, from the first frames of
// both to their last, never stepping back in either: pair k is
// (native[k], take[k]).
export type AlignmentPath = Readonly<{
  native: Int32Array
  take: Int32Array
}>

// Spec, "The score's interface": ticket 10 chooses one, and ticket 20 may
// plug in a speech model's features. An aligner that cannot line the two
// up answers null, and the score falls back (`withFallback`).
export interface Aligner {
  readonly name: string
  align(native: Features, take: Features): AlignmentPath | null
}

// Each dimension shifted and scaled to mean 0 and variance 1 over frames
// `from` to `to` (exclusive), which are returned alone: the take's own
// microphone and voice colour taken out, so two speakers' features meet
// on the sounds they share.
export const normaliseFeatures = (
  features: Features,
  from: number,
  to: number,
): Features => {
  const { dims } = features
  const frames = Math.max(0, Math.min(to, featureFrames(features)) - from)
  const data = features.data.slice(from * dims, (from + frames) * dims)
  for (let d = 0; d < dims; d++) {
    let sum = 0
    for (let f = 0; f < frames; f++) {
      sum += data[f * dims + d] ?? 0
    }
    const mean = frames > 0 ? sum / frames : 0
    let squares = 0
    for (let f = 0; f < frames; f++) {
      const centred = (data[f * dims + d] ?? 0) - mean
      squares += centred * centred
    }
    const deviation = frames > 0 ? Math.sqrt(squares / frames) : 0
    const scale = deviation > 1e-6 ? 1 / deviation : 0
    for (let f = 0; f < frames; f++) {
      const at = f * dims + d
      data[at] = ((data[at] ?? 0) - mean) * scale
    }
  }
  return { frameHz: features.frameHz, dims, data }
}

// The take stretched evenly over the native: the path a take at a steady
// tempo would give, and the fallback when an aligner fails.
export const stretchAligner: Aligner = {
  name: 'stretch',
  align: (native, take) => {
    const n = featureFrames(native)
    const m = featureFrames(take)
    if (n === 0 || m === 0) {
      return null
    }
    const pairs = Math.max(n, m)
    const nativeFrames = new Int32Array(pairs)
    const takeFrames = new Int32Array(pairs)
    for (let k = 0; k < pairs; k++) {
      const at = pairs === 1 ? 0 : k / (pairs - 1)
      nativeFrames[k] = Math.round(at * (n - 1))
      takeFrames[k] = Math.round(at * (m - 1))
    }
    return { native: nativeFrames, take: takeFrames }
  },
}

export type DtwOptions = Readonly<{
  // The band either side of the stretched diagonal, as a share of the
  // longer recording, and at least `bandSeconds` wide.
  bandShare: number
  bandSeconds: number
  // A path whose mean distance per pair is over this matched nothing (a
  // different sentence, or noise), and the aligner answers null.
  failDistance: number
}>

const euclidean = (
  a: Float32Array,
  i: number,
  b: Float32Array,
  j: number,
  dims: number,
): number => {
  let sum = 0
  for (let d = 0; d < dims; d++) {
    const step = (a[i * dims + d] ?? 0) - (b[j * dims + d] ?? 0)
    sum += step * step
  }
  return Math.sqrt(sum)
}

// Dynamic time warping over the features, with a Sakoe-Chiba band around
// the diagonal that stretches the take over the native: each frame pair
// costs the distance between their features, and the path is the
// cheapest from the first pair to the last that moves one frame on in
// either recording, or both, at each step.
export const dtwAligner = (options: DtwOptions): Aligner => ({
  name: 'dtw',
  align: (native, take) => {
    const n = featureFrames(native)
    const m = featureFrames(take)
    const { dims } = native
    if (
      n < 2 ||
      m < 2 ||
      take.dims !== dims ||
      take.frameHz !== native.frameHz
    ) {
      return null
    }
    // Wide enough that each row's cells meet the last row's.
    const band = Math.max(
      Math.ceil(options.bandShare * Math.max(n, m)),
      Math.ceil(options.bandSeconds * native.frameHz),
      Math.ceil(m / n) + 1,
    )
    const width = 2 * band + 1
    const centreOf = (i: number): number => Math.round((i * (m - 1)) / (n - 1))
    const cost = new Float64Array(n * width).fill(Number.POSITIVE_INFINITY)
    // The cost of (i, j), or infinity outside the band.
    const at = (i: number, j: number): number => {
      const k = j - centreOf(i) + band
      return i < 0 || j < 0 || k < 0 || k >= width
        ? Number.POSITIVE_INFINITY
        : (cost[i * width + k] ?? Number.POSITIVE_INFINITY)
    }
    for (let i = 0; i < n; i++) {
      const centre = centreOf(i)
      const from = Math.max(0, centre - band)
      const to = Math.min(m - 1, centre + band)
      for (let j = from; j <= to; j++) {
        const distance = euclidean(native.data, i, take.data, j, dims)
        cost[i * width + j - centre + band] =
          i === 0 && j === 0
            ? distance
            : Math.min(
                at(i - 1, j - 1) + distance,
                at(i - 1, j) + distance,
                at(i, j - 1) + distance,
              )
      }
    }
    const total = at(n - 1, m - 1)
    if (!Number.isFinite(total)) {
      return null
    }

    const nativeFrames: Array<number> = []
    const takeFrames: Array<number> = []
    let i = n - 1
    let j = m - 1
    nativeFrames.push(i)
    takeFrames.push(j)
    while (i > 0 || j > 0) {
      const here = euclidean(native.data, i, take.data, j, dims)
      const diagonal = at(i - 1, j - 1) + here
      const up = at(i - 1, j) + here
      const left = at(i, j - 1) + here
      if (diagonal <= up && diagonal <= left) {
        i--
        j--
      } else if (up <= left) {
        i--
      } else {
        j--
      }
      nativeFrames.push(i)
      takeFrames.push(j)
    }
    nativeFrames.reverse()
    takeFrames.reverse()

    if (total / nativeFrames.length > options.failDistance) {
      return null
    }
    return {
      native: Int32Array.from(nativeFrames),
      take: Int32Array.from(takeFrames),
    }
  },
})

// `primary`, or `fallback` where it fails.
export const withFallback = (primary: Aligner, fallback: Aligner): Aligner => ({
  name: `${primary.name}, else ${fallback.name}`,
  align: (native, take) =>
    primary.align(native, take) ?? fallback.align(native, take),
})
