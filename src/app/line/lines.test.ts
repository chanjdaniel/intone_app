import { describe, expect, test } from 'vitest'

import ameGaSukiInline from '../../../fixtures/voices/ame-ga-suki/meimei-himari/right.wav?inline'
import { decodeWav } from '../../engine/audio/wav'
import { bundledClips, bundledLines, clockText } from './lines'

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

describe('bundledClips', () => {
  test('the bundled line lasts as long as its file, which its level shows', () => {
    const [clip] = bundledClips
    const [line] = clip?.lines ?? []
    const bytes = Uint8Array.from(
      atob(ameGaSukiInline.slice(ameGaSukiInline.indexOf(',') + 1)),
      character => character.charCodeAt(0),
    )
    const wav = decodeWav(bytes)
    expect(line?.seconds).toBe((wav.channels[0]?.length ?? 0) / wav.sampleRate)
    expect(bundledClips.flatMap(found => found.lines)).toStrictEqual(
      bundledLines,
    )
  })
})
