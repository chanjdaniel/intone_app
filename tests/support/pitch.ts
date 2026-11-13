// A simple pitch estimate for measuring test audio, never the app's
// tracker: YIN's cumulative mean normalised difference (de Cheveigné and
// Kawahara, 2002) between two 25 ms windows a lag apart, the pair centred
// on each frame's instant, so a gliding pitch is read where it is. The
// first dip close to the deepest one is the period, refined by parabolic
// interpolation; NaN where no dip is deep enough. Frame k is read at
// `startSeconds + k / frameHz` into the samples.

const minimumHz = 60
const maximumHz = 600
const windowSeconds = 0.025
const threshold = 0.15
// How close to the deepest dip the chosen one must be, which keeps a strong
// second harmonic's dip at half the period from reading an octave high.
const nearDeepest = 0.02

export const estimatePitch = (
  samples: Float32Array,
  sampleRate: number,
  frameHz: number,
  startSeconds = 0,
): Float64Array => {
  const window = Math.round(windowSeconds * sampleRate)
  const shortestLag = Math.floor(sampleRate / maximumHz)
  const longestLag = Math.ceil(sampleRate / minimumHz)
  const frames = Math.max(
    0,
    Math.floor((samples.length / sampleRate - startSeconds) * frameHz),
  )
  const estimate = new Float64Array(frames).fill(Number.NaN)
  const difference = new Float64Array(longestLag + 2)

  for (let frame = 0; frame < frames; frame++) {
    const centre = (startSeconds + frame / frameHz) * sampleRate
    const first = Math.round(centre - (window + longestLag + 1) / 2)
    if (first < 0 || first + window + longestLag + 1 > samples.length) {
      continue
    }
    let energy = 0
    for (let i = 0; i < window; i++) {
      energy += (samples[Math.round(centre - window / 2) + i] ?? 0) ** 2
    }
    if (energy / window < 1e-7) {
      continue
    }
    let runningSum = 0
    difference[0] = 1
    for (let lag = 1; lag <= longestLag + 1; lag++) {
      const start = Math.round(centre - (window + lag) / 2)
      let sum = 0
      for (let i = 0; i < window; i++) {
        const delta =
          (samples[start + i] ?? 0) - (samples[start + i + lag] ?? 0)
        sum += delta * delta
      }
      runningSum += sum
      difference[lag] = runningSum === 0 ? 1 : (sum * lag) / runningSum
    }
    let deepest = 1
    for (let lag = shortestLag; lag <= longestLag; lag++) {
      deepest = Math.min(deepest, difference[lag] ?? 1)
    }
    const deepEnough = Math.min(threshold, deepest + nearDeepest)
    let chosen = -1
    for (let lag = shortestLag; lag <= longestLag; lag++) {
      if ((difference[lag] ?? 1) <= deepEnough) {
        while (
          lag + 1 <= longestLag &&
          (difference[lag + 1] ?? 1) < (difference[lag] ?? 1)
        ) {
          lag++
        }
        chosen = lag
        break
      }
    }
    if (chosen < 0) {
      continue
    }
    const before = difference[chosen - 1] ?? 1
    const at = difference[chosen] ?? 1
    const after = difference[chosen + 1] ?? 1
    const curvature = before - 2 * at + after
    const shift =
      curvature <= 0
        ? 0
        : Math.max(-1, Math.min(1, (0.5 * (before - after)) / curvature))
    estimate[frame] = sampleRate / (chosen + shift)
  }
  return estimate
}

export type PitchError = Readonly<{
  // Frames compared, and those of them with no estimate.
  frames: number
  missing: number
  // Absolute distance from the reference, in cents, over the estimated
  // frames.
  medianCents: number
  p95Cents: number
  maxCents: number
}>

const quantile = (sorted: ReadonlyArray<number>, q: number): number =>
  sorted[Math.round(q * (sorted.length - 1))] ?? Number.NaN

// How far an estimate is from a reference curve, on the given frames.
export const pitchError = (
  estimate: ArrayLike<number>,
  reference: ArrayLike<number | null>,
  frames: ReadonlyArray<number>,
): PitchError => {
  const cents = frames.flatMap(frame => {
    const hz = estimate[frame] ?? Number.NaN
    const truth = reference[frame] ?? null
    return truth === null || !Number.isFinite(hz)
      ? []
      : [Math.abs(1200 * Math.log2(hz / truth))]
  })
  const sorted = [...cents].sort((a, b) => a - b)
  return {
    frames: frames.length,
    missing: frames.length - cents.length,
    medianCents: quantile(sorted, 0.5),
    p95Cents: quantile(sorted, 0.95),
    maxCents: quantile(sorted, 1),
  }
}
