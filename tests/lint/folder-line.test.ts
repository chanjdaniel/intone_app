import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'

// The folder line (AGENTS.md) is enforced by the project's own oxlint
// config. Each fixture under `fixtures/src/` sits where the folder it tests
// would, and marks every line lint must refuse with `// lint: <rule>`; a
// fixture with no marks must lint clean, so a rule cannot reach too far.

const root = join(import.meta.dirname, '..', '..')
const fixtures = join(import.meta.dirname, 'fixtures')

type Diagnostic = { file: string; line: number; code: string }

type OxlintReport = {
  diagnostics: ReadonlyArray<{
    code: string
    filename: string
    labels: ReadonlyArray<{ span: { line: number } }>
  }>
}

const fixtureFiles = (directory: string): ReadonlyArray<string> =>
  readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.ts'))
    .map(entry => relative(root, join(entry.parentPath, entry.name)))
    .sort()

const marked = (file: string): ReadonlyArray<Diagnostic> =>
  readFileSync(join(root, file), 'utf8')
    .split('\n')
    .flatMap((text, index) => {
      const mark = /\/\/ lint: (\S+)$/.exec(text)
      return mark?.[1] === undefined
        ? []
        : [{ file, line: index + 1, code: mark[1] }]
    })

const oxlint = (args: ReadonlyArray<string>): OxlintReport => {
  const run = spawnSync(
    join(root, 'node_modules', '.bin', 'oxlint'),
    ['--format', 'json', ...args],
    { cwd: root, encoding: 'utf8' },
  )
  if (run.error !== undefined) throw run.error
  return JSON.parse(run.stdout)
}

const found = (report: OxlintReport): ReadonlyArray<Diagnostic> =>
  report.diagnostics.map(diagnostic => ({
    file: diagnostic.filename,
    line: diagnostic.labels[0]?.span.line ?? 0,
    code: diagnostic.code,
  }))

const byPosition = (a: Diagnostic, b: Diagnostic): number =>
  a.file.localeCompare(b.file) ||
  a.line - b.line ||
  a.code.localeCompare(b.code)

describe('the folder line', () => {
  const files = fixtureFiles(fixtures)

  test('has fixtures that refuse something and fixtures that allow it', () => {
    expect(
      files.filter(file => marked(file).length > 0).length,
    ).toBeGreaterThan(0)
    expect(
      files.filter(file => marked(file).length === 0).length,
    ).toBeGreaterThan(0)
  })

  test('lint refuses exactly the marked lines of every fixture', () => {
    const report = oxlint(['--config', '.oxlintrc.json', ...files])

    expect(found(report).toSorted(byPosition)).toEqual(
      files.flatMap(marked).toSorted(byPosition),
    )
  })

  test('the normal lint run skips the fixtures and passes', () => {
    const run = spawnSync('npm', ['run', '--silent', 'lint'], {
      cwd: root,
      encoding: 'utf8',
    })

    expect(run.stdout + run.stderr).not.toContain('tests/lint/fixtures')
    expect(run.status).toBe(0)
  })
})
