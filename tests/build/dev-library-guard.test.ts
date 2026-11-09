import {
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { chunksOf, productionBuild } from '../support/build'
import { root } from '../support/run'

// The dev library guard, through real production builds with the
// project's own config: an entry planted outside src/ reaches the dev
// library the ways lint cannot see.

const devFolder = realpathSync(join(root, 'src', 'app', 'dev'))
let planted = ''

beforeAll(() => {
  planted = mkdtempSync(join(tmpdir(), 'dev-library-guard-'))
  symlinkSync(devFolder, join(planted, 'linked-dev'), 'dir')
})

afterAll(() => {
  rmSync(planted, { recursive: true, force: true })
})

const plantEntry = (name: string, code: string): string => {
  const path = join(planted, name)
  writeFileSync(path, code)
  return path
}

// The planted entries export what they import, so the build keeps it.
const buildFrom = (input: string) =>
  productionBuild({
    build: {
      write: false,
      rolldownOptions: { input, preserveEntrySignatures: 'strict' },
    },
  })

describe('the dev library guard', () => {
  test('passes the real app, whose build holds no dev library module', async () => {
    const output = await productionBuild({ build: { write: false } })

    expect(chunksOf(output).length).toBeGreaterThan(0)
  })

  test('fails a build that imports the library dynamically, naming chunk and module', async () => {
    const entry = plantEntry(
      'imports-dynamically.ts',
      `export const open = () => import(${JSON.stringify(join(devFolder, 'library.ts'))})\n`,
    )

    await expect(buildFrom(entry)).rejects.toThrow(
      /is in a production build:\n(.*\n)*  chunk assets\/library-[\w-]+\.js: src\/app\/dev\/library\.ts\n/,
    )
  })

  test('fails a build that keeps a development-only branch alive', async () => {
    const entry = plantEntry(
      'keeps-the-branch.ts',
      [
        '// A branch the build cannot drop: its test is not import.meta.env.DEV.',
        `export const open = (yes: boolean) => yes ? import(${JSON.stringify(join(devFolder, 'entries', 'tokens.ts'))}) : undefined`,
        '',
      ].join('\n'),
    )

    await expect(buildFrom(entry)).rejects.toThrow(
      ': src/app/dev/entries/tokens.ts',
    )
  })

  test("fails the app's own build when its development-only branch stays alive", async () => {
    await expect(
      productionBuild({
        define: { 'import.meta.env.DEV': 'true' },
        build: { write: false },
      }),
    ).rejects.toThrow(': src/app/dev/library.ts')
  })

  test('fails a build that reaches the library through a link to its folder', async () => {
    const entry = plantEntry(
      'imports-through-a-link.ts',
      "export const open = () => import('./linked-dev/library.ts')\n",
    )

    await expect(buildFrom(entry)).rejects.toThrow(': src/app/dev/library.ts')
  })
})
