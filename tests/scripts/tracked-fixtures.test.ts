import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { root, run } from '../support/run.ts'
import {
  decodeTracked,
  encodeTracked,
  fixtureSources,
  readTracked,
  trackedDirectory,
  trackedPathOf,
} from '../support/tracked-fixtures.ts'

// fixtures/tracked/ is every fixture's curve and features as the app makes
// them (tests/support/tracked-fixtures.ts): `npm run fixtures:tracked`
// writes it on the real SwiftF0 model, and it must come out the same, byte
// for byte.

let scratch = ''

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'tracked-fixtures-'))
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

const filesUnder = (dir: string): ReadonlyArray<string> =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => relative(dir, join(entry.parentPath, entry.name)))
    .sort()

describe('the tracked fixtures', () => {
  test('hold one file for every fixture WAV', () => {
    const sources = fixtureSources()
    expect(sources).toHaveLength(3 * 8 * 7 * 3 + 3 + 3 + 1)
    expect(filesUnder(trackedDirectory)).toStrictEqual(
      sources.map(trackedPathOf).sort(),
    )
  })

  test('regenerate byte for byte on the real model', () => {
    const result = run('node', [
      '--import',
      './scripts/source-imports.ts',
      join(root, 'scripts', 'tracked-fixtures.ts'),
      '--out',
      scratch,
    ])
    expect(result.output).toBe('')
    expect(result.status).toBe(0)
    const made = filesUnder(scratch)
    expect(made).toStrictEqual(filesUnder(trackedDirectory))
    for (const file of made) {
      expect(
        Buffer.compare(
          readFileSync(join(scratch, file)),
          readFileSync(join(trackedDirectory, file)),
        ),
        file,
      ).toBe(0)
    }
  }, 300_000)

  test('read back as they were written', () => {
    const tracked = readTracked('voices/ame-ga-suki/meimei-himari/right')
    expect(tracked.header).toMatchObject({
      format: 1,
      source: 'voices/ame-ga-suki/meimei-himari/right.wav',
      analysis: 'Tracked',
      frameHz: 62.5,
      features: { bands: 24, lowHz: 100, highHz: 7600, dims: 24 },
    })
    expect(tracked.curve?.f0Hz).toHaveLength(tracked.header.frames)
    expect(tracked.features.data).toHaveLength(tracked.header.frames * 24)
    expect(decodeTracked(encodeTracked(tracked))).toStrictEqual(tracked)
    // The room noise holds no voice: it has features and no curve.
    const noise = readTracked('noise/classroom')
    expect(noise.header.analysis).toBe('TooNoisy')
    expect(noise.curve).toBeNull()
    expect(noise.features.data.length).toBeGreaterThan(0)
  })
})
