import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'

import { root, run } from '../support/run.ts'

// fixtures/formats/ is one CC0 stretch in each format a learner may
// bring, as `npm run fixtures:formats` writes it. Its ffmpeg is pinned:
// where that ffmpeg is installed, the files are remade byte for byte.

const formats = join(root, 'fixtures', 'formats')
const listed: {
  ffmpeg: string
  formats: ReadonlyArray<{ file: string; what: string }>
} = JSON.parse(readFileSync(join(formats, 'formats.json'), 'utf8'))

let scratch = ''

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'format-fixtures-'))
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

test('every listed format is there, and nothing else', () => {
  expect(readdirSync(formats).sort()).toStrictEqual(
    ['formats.json', ...listed.formats.map(({ file }) => file)].sort(),
  )
})

const installedFfmpeg = (): string | undefined => {
  try {
    return /^ffmpeg version \S+/.exec(run('ffmpeg', ['-version']).output)?.[0]
  } catch {
    return undefined
  }
}
const ffmpegVersion = installedFfmpeg()

test.runIf(ffmpegVersion === listed.ffmpeg)(
  'the files are what the script makes, byte for byte',
  () => {
    const result = run('node', [
      join(root, 'scripts', 'format-fixtures.ts'),
      '--out',
      scratch,
    ])
    expect(result.status).toBe(0)
    readdirSync(formats).forEach(file => {
      expect(readFileSync(join(scratch, file)), file).toStrictEqual(
        readFileSync(join(formats, file)),
      )
    })
  },
)
