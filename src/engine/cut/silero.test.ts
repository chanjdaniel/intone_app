import { describe, expect, test } from 'vitest'

import {
  type SileroInference,
  sileroContext,
  sileroStateSize,
  sileroWindow,
  speechProbabilities,
  windowCount,
} from './silero'

// A stand-in model that records what it was given and answers each
// window with its mean, and a state counting the runs.
const recording = () => {
  const inputs: Array<Float32Array> = []
  const states: Array<Float32Array> = []
  const infer: SileroInference = async (input, state) => {
    inputs.push(Float32Array.from(input))
    states.push(Float32Array.from(state))
    const window = input.subarray(sileroContext)
    const mean = window.reduce((sum, value) => sum + value, 0) / window.length
    return {
      probability: mean,
      state: new Float32Array(sileroStateSize).fill((state[0] ?? 0) + 1),
    }
  }
  return { infer, inputs, states }
}

const ramp = (length: number) =>
  Float32Array.from({ length }, (_, k) => (k % 1000) / 1000)

describe('speechProbabilities', () => {
  test('one probability per 32 ms window, the last one padded', async () => {
    const samples = ramp(3 * sileroWindow + 100)
    const { infer, inputs } = recording()
    const probabilities = await speechProbabilities(samples, infer)
    expect(windowCount(samples.length)).toBe(4)
    expect(probabilities).toHaveLength(4)
    expect(inputs).toHaveLength(4)
    const last = inputs[3]
    expect(last?.subarray(sileroContext, sileroContext + 100)).toEqual(
      samples.subarray(3 * sileroWindow),
    )
    expect(last?.subarray(sileroContext + 100).every(v => v === 0)).toBe(true)
  })

  test('each window runs with the 64 samples before it, zeros before the first', async () => {
    const samples = ramp(3 * sileroWindow)
    const { infer, inputs } = recording()
    await speechProbabilities(samples, infer)
    expect(inputs[0]?.subarray(0, sileroContext).every(v => v === 0)).toBe(true)
    inputs.forEach((input, k) => {
      expect(input).toHaveLength(sileroContext + sileroWindow)
      expect(input.subarray(sileroContext)).toEqual(
        samples.subarray(k * sileroWindow, (k + 1) * sileroWindow),
      )
      if (k > 0) {
        expect(input.subarray(0, sileroContext)).toEqual(
          samples.subarray(k * sileroWindow - sileroContext, k * sileroWindow),
        )
      }
    })
  })

  test('each run gets the state the last one left, zeros first', async () => {
    const { infer, states } = recording()
    await speechProbabilities(ramp(5 * sileroWindow), infer)
    expect(states.map(state => state[0])).toEqual([0, 1, 2, 3, 4])
    expect(states[0]).toHaveLength(sileroStateSize)
  })

  test('the probabilities are what the model said, in order', async () => {
    const samples = new Float32Array(4 * sileroWindow)
    samples.fill(0.5, sileroWindow, 2 * sileroWindow)
    const { infer } = recording()
    expect(Array.from(await speechProbabilities(samples, infer))).toEqual([
      0, 0.5, 0, 0,
    ])
  })

  test('progress is heard now and then, and at the end', async () => {
    const heard: Array<[number, number]> = []
    const { infer } = recording()
    await speechProbabilities(
      ramp(1000 * sileroWindow),
      infer,
      (done, total) => {
        heard.push([done, total])
      },
    )
    expect(heard.length).toBeGreaterThanOrEqual(10)
    expect(heard.length).toBeLessThanOrEqual(101)
    expect(heard.at(-1)).toEqual([1000, 1000])
    heard.forEach(([done], k) => {
      expect(done).toBeGreaterThan(heard[k - 1]?.[0] ?? 0)
    })
  })

  test('no audio, no windows', async () => {
    const { infer } = recording()
    expect(await speechProbabilities(new Float32Array(0), infer)).toHaveLength(
      0,
    )
  })
})
