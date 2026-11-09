// mulberry32: a small seeded generator, uniform in [0, 1), so generated
// test audio comes out the same every run.
export const random = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let x = state
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

// A seed from a name, by FNV-1a over its UTF-16 code units, so each
// fixture draws its own sequence without a table of seeds.
export const seedOf = (name: string): number => {
  let hash = 0x811c9dc5
  for (let i = 0; i < name.length; i++) {
    hash = Math.imul(hash ^ name.charCodeAt(i), 0x01000193) >>> 0
  }
  return hash
}
