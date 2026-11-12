export { random } from '../../src/score/random.ts'

// A seed from a name, by FNV-1a over its UTF-16 code units, so each
// fixture draws its own sequence without a table of seeds.
export const seedOf = (name: string): number => {
  let hash = 0x811c9dc5
  for (let i = 0; i < name.length; i++) {
    hash = Math.imul(hash ^ name.charCodeAt(i), 0x01000193) >>> 0
  }
  return hash
}
