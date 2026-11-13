import { describe, expect, it } from 'vitest'

import { createOnsetFinder } from './onset'

const frames = (hz: ReadonlyArray<number>): Float32Array =>
  Float32Array.from(hz)

describe('the onset finder', () => {
  it('finds the first frame of the first run of three voiced frames', () => {
    const finder = createOnsetFinder()
    expect(finder.push(0, frames([0, 120, 0, 0, 130, 131, 132, 0]))).toBe(4)
  })

  it('finds a run split across pushes, and keeps its answer', () => {
    const finder = createOnsetFinder()
    expect(finder.push(0, frames([0, 0, 120]))).toBe(null)
    expect(finder.push(3, frames([121]))).toBe(null)
    expect(finder.push(4, frames([122, 0, 0]))).toBe(2)
    expect(finder.push(7, frames([0, 140, 141, 142]))).toBe(2)
  })

  it('has none while no run is long enough', () => {
    const finder = createOnsetFinder()
    expect(finder.push(0, frames([120, 121, 0, 122, 123, 0]))).toBe(null)
  })
})
