// mulberry32: a small seeded generator, uniform in [0, 1), so whatever is
// drawn from a seed (synthetic takes, the dev library's samples, test
// audio) comes out the same every run. Every folder may import it.
export const random = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
