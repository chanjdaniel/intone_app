// A radix-2 FFT of real frames, for the spectral features: the tables are
// made once per size, and each transform writes into arrays it is given.

export type RealFft = Readonly<{
  size: number
  // The power of bins 0 to size / 2 of `frame` (length `size`), written to
  // `power` (length size / 2 + 1). `frame` is left as it was.
  power: (frame: Float32Array, power: Float32Array) => void
}>

export const createRealFft = (size: number): RealFft => {
  if (size < 2 || (size & (size - 1)) !== 0) {
    throw new RangeError(
      `an FFT of ${size} points: the size must be a power of 2`,
    )
  }
  const bits = Math.log2(size)
  const reversed = new Uint32Array(size)
  for (let i = 0; i < size; i++) {
    let r = 0
    for (let b = 0; b < bits; b++) {
      r |= ((i >> b) & 1) << (bits - 1 - b)
    }
    reversed[i] = r
  }
  const cos = new Float64Array(size / 2)
  const sin = new Float64Array(size / 2)
  for (let k = 0; k < size / 2; k++) {
    cos[k] = Math.cos((2 * Math.PI * k) / size)
    sin[k] = -Math.sin((2 * Math.PI * k) / size)
  }
  const re = new Float64Array(size)
  const im = new Float64Array(size)

  const power = (frame: Float32Array, out: Float32Array): void => {
    for (let i = 0; i < size; i++) {
      re[reversed[i] ?? 0] = frame[i] ?? 0
      im[i] = 0
    }
    for (let half = 1; half < size; half <<= 1) {
      const step = size / (half << 1)
      for (let start = 0; start < size; start += half << 1) {
        for (let k = 0; k < half; k++) {
          const wr = cos[k * step] ?? 1
          const wi = sin[k * step] ?? 0
          const a = start + k
          const b = a + half
          const br = re[b] ?? 0
          const bi = im[b] ?? 0
          const tr = br * wr - bi * wi
          const ti = br * wi + bi * wr
          const ar = re[a] ?? 0
          const ai = im[a] ?? 0
          re[b] = ar - tr
          im[b] = ai - ti
          re[a] = ar + tr
          im[a] = ai + ti
        }
      }
    }
    for (let k = 0; k <= size / 2; k++) {
      const r = re[k] ?? 0
      const i = im[k] ?? 0
      out[k] = r * r + i * i
    }
  }

  return { size, power }
}
