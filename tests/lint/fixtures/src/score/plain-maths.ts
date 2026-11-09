// Allowed: plain maths on typed arrays, with the language's own built-ins.
import { MEDIAN_WINDOW } from './constants'

export const median = (values: Float32Array): number => {
  const sorted = Float32Array.from(values).sort()
  const middle = Math.floor(sorted.length / 2)
  return Number.isFinite(sorted[middle]) ? (sorted[middle] ?? 0) : MEDIAN_WINDOW
}

export const byLine = new Map<string, number>()
export const ready: Promise<void> = Promise.resolve()
export const message = (error: unknown): string =>
  error instanceof Error ? error.message : JSON.stringify(error)
