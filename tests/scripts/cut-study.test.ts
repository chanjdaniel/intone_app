import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'

import { root, run } from '../support/run.ts'

// docs/cut-study.md is what `npm run cut:study` writes from the CC0 clips
// in fixtures/real/, on the real models: any change to the cutting, the
// tracking or the clips shows here.

let scratch = ''

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'cut-study-'))
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

test('docs/cut-study.md is current', () => {
  const out = join(scratch, 'cut-study.md')
  const result = run('node', [
    '--import',
    './scripts/source-imports.ts',
    join(root, 'scripts', 'cut-study.ts'),
    '--out',
    out,
  ])
  expect(result.output).toBe('')
  expect(result.status).toBe(0)
  expect(readFileSync(out, 'utf8')).toBe(
    readFileSync(join(root, 'docs', 'cut-study.md'), 'utf8'),
  )
})
