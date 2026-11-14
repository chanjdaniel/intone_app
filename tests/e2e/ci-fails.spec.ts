// Fails on purpose, to show CI's e2e job goes red; reverted at once.
import { expect, test } from '@playwright/test'

test('fails on purpose', () => {
  expect(1).toBe(2)
})
