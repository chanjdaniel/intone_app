import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'

import { root, run } from '../support/run.ts'

// fixtures/local-pack/ is the example local pack the tests import, as
// `npm run fixtures:local-pack` writes it from the fixtures beside it:
// remade here byte for byte, in Node alone.

const committed = join(root, 'fixtures', 'local-pack')
let scratch = ''

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'local-pack-fixture-'))
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

const filesIn = (folder: string): ReadonlyArray<string> =>
  readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => relative(folder, join(entry.parentPath, entry.name)))
    .sort()

test('the example pack is what the script makes, byte for byte', () => {
  const result = run('node', [
    join(root, 'scripts', 'local-pack-fixture.ts'),
    '--out',
    scratch,
  ])
  expect(result.status, result.output).toBe(0)

  expect(filesIn(scratch)).toStrictEqual([
    'audio/gongitsune.wav',
    'audio/hashi.wav',
    'audio/kyou.wav',
    'pack.json',
  ])
  expect(filesIn(committed)).toStrictEqual(filesIn(scratch))
  filesIn(scratch).forEach(file => {
    expect(
      Buffer.compare(
        readFileSync(join(scratch, file)),
        readFileSync(join(committed, file)),
      ),
      file,
    ).toBe(0)
  })
})
