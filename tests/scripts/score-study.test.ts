import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'

import { root, run } from '../support/run.ts'

// docs/score-study.md is what `npm run score:study` writes from
// fixtures/tracked/, and the scale's anchors in src/score/constants.ts are
// what it measures: the script fails while they have drifted apart.

let scratch = ''

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'score-study-'))
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

test('docs/score-study.md is current, and so are the anchors', () => {
  const out = join(scratch, 'score-study.md')
  const result = run('node', [
    '--import',
    './scripts/source-imports.ts',
    join(root, 'scripts', 'score-study.ts'),
    '--out',
    out,
  ])
  expect(result.output).toBe('')
  expect(result.status).toBe(0)
  expect(readFileSync(out, 'utf8')).toBe(
    readFileSync(join(root, 'docs', 'score-study.md'), 'utf8'),
  )
})
