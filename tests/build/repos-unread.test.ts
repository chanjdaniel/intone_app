import { spawnSync } from 'node:child_process'
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

// repos/foldkit/ is Foldkit's source, vendored as reading only. Plant files
// there that every check would refuse, and that the build would pick up if
// it scanned them, and prove that none of the project's checks reads them.

const root = join(import.meta.dirname, '..', '..')

// A Tailwind class no project file uses: if Tailwind scanned repos/, the
// built CSS would hold it.
const plantedColour = 'a1b2c3'

let planted = ''
let output = ''

type Run = { status: number | null; output: string }

const run = (command: string, args: ReadonlyArray<string>): Run => {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  return { status: result.status, output: result.stdout + result.stderr }
}

const npm = (script: string): Run => run('npm', ['run', '--silent', script])

beforeAll(() => {
  planted = mkdtempSync(join(root, 'repos', 'foldkit', 'planted-'))
  output = mkdtempSync(join(tmpdir(), 'repos-unread-build-'))
  writeFileSync(
    join(planted, 'wrong.ts'),
    [
      '// Planted by tests/build/repos-unread.test.ts: wrong on purpose.',
      "import { Runtime } from 'foldkit'",
      "export const planted: number = 'a type error'",
      'var   unused = Runtime',
      `export const colour = 'bg-[#${plantedColour}]'`,
      '',
    ].join('\n'),
  )
  writeFileSync(
    join(planted, 'wrong.test.ts'),
    [
      "import { test } from 'vitest'",
      "test('planted', () => { throw new Error('planted') })",
      '',
    ].join('\n'),
  )
})

afterAll(() => {
  rmSync(planted, { recursive: true, force: true })
  rmSync(output, { recursive: true, force: true })
})

const plantedName = (): string => relative(join(root, 'repos'), planted)

describe('nothing reads repos/', () => {
  test.each(['lint', 'typecheck', 'check:effect', 'format:check'])(
    '%s passes with a planted error there',
    script => {
      const result = npm(script)

      expect(result.output).not.toContain(plantedName())
      expect(result.status, result.output).toBe(0)
    },
  )

  test('the tests do not collect a planted test file there', () => {
    const result = run('npx', ['vitest', 'list', '--filesOnly'])

    expect(result.status, result.output).toBe(0)
    expect(result.output).toContain('src/app/main.test.ts')
    expect(result.output).not.toContain(plantedName())
  })

  test('the build does not scan it for Tailwind classes', () => {
    const result = run('npx', [
      'vite',
      'build',
      '--outDir',
      output,
      '--emptyOutDir',
    ])

    expect(result.status, result.output).toBe(0)
    const built = readdirSync(output, { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => readFileSync(join(entry.parentPath, entry.name), 'utf8'))
    expect(built.length).toBeGreaterThan(0)
    expect(built.join('\n')).not.toContain(plantedColour)
  })
})
