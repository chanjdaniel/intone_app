// Fails on purpose, to show CI's check job goes red; reverted at once.
import { expect, test } from 'vitest'

test('fails on purpose', () => {
  expect(1).toBe(2)
})
