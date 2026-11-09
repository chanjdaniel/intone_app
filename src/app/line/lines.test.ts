import { describe, expect, test } from 'vitest'

import { clockText } from './lines'

describe('clockText', () => {
  test('gives minutes and seconds, and tenths when asked, never rounding up', () => {
    expect(clockText(65.4)).toBe('1:05')
    expect(clockText(3.69, true)).toBe('0:03.6')
    expect(clockText(59.99, true)).toBe('0:59.9')
  })

  test('reads a time a tenth that floats just under it as that tenth', () => {
    expect(clockText(14.1, true)).toBe('0:14.1')
    expect(clockText(0.3, true)).toBe('0:00.3')
    expect(clockText(6.7, true)).toBe('0:06.7')
  })
})
