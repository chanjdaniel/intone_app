import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'

import { root, run } from '../support/run'

// The folder line (AGENTS.md) is enforced by the project's own oxlint
// config. Each fixture under `fixtures/src/` sits where the folder it tests
// would, and marks every line lint must refuse with `// lint: <rule>`; a
// fixture with no marks must lint clean, so a rule cannot reach too far.

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

// oxlint exits 1 when it reports a diagnostic; anything else is a crash.
const oxlint = (args: ReadonlyArray<string>): OxlintReport => {
  const result = run(join(root, 'node_modules', '.bin', 'oxlint'), [
    '--format',
    'json',
    ...args,
  ])
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`oxlint exited ${result.status}:\n${result.output}`)
  }
  return JSON.parse(result.stdout)
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
    const result = run('npm', ['run', '--silent', 'lint'])

    expect(result.output).not.toContain('tests/lint/fixtures')
    expect(result.status, result.output).toBe(0)
  })
})
