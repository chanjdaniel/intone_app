import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

// scripts/vendor-foldkit.sh run against a stand-in for Foldkit's repository:
// a local git repository with the same maintainer files, tagged the way
// Foldkit tags its releases.

const script = join(
  import.meta.dirname,
  '..',
  '..',
  'scripts',
  'vendor-foldkit.sh',
)

// Git with no user or system config, so the machine's hooks, signing and
// default branch cannot change what the test sees.
const gitEnvironment = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
}

type Run = { status: number | null; output: string }

const run = (
  cwd: string,
  command: string,
  args: ReadonlyArray<string>,
  environment: Record<string, string> = {},
): Run => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...gitEnvironment, ...environment },
  })
  if (result.error !== undefined) throw result.error
  return { status: result.status, output: result.stdout + result.stderr }
}

const git = (cwd: string, ...args: ReadonlyArray<string>): string => {
  const result = run(cwd, 'git', args)
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed:\n${result.output}`)
  }
  return result.output.trim()
}

const write = (root: string, files: Record<string, string>): void => {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
}

const template = 'packages/create-foldkit-app/templates/base/FOLDKIT.md'

let scratch = ''
let upstream = ''
let project = ''

const release = (version: string, files: Record<string, string>): void => {
  write(upstream, files)
  git(upstream, 'add', '--all')
  git(upstream, 'commit', '--quiet', '--message', `release ${version}`)
  git(upstream, 'tag', `foldkit@${version}`)
}

const install = (version: string): void =>
  write(project, {
    'node_modules/foldkit/package.json': JSON.stringify({ version }),
  })

const vendor = (): Run =>
  run(project, script, [], { FOLDKIT_REPOSITORY: upstream })

const tracked = (): ReadonlyArray<string> =>
  git(project, 'ls-files').split('\n')

const read = (path: string): string => readFileSync(join(project, path), 'utf8')

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'vendor-foldkit-'))
  upstream = join(scratch, 'foldkit')
  project = join(scratch, 'project')
  mkdirSync(upstream)
  mkdirSync(project)

  git(upstream, 'init', '--quiet', '--initial-branch', 'main')
  release('1.0.0', {
    'CLAUDE.md': 'Foldkit maintainers: run our checks.\n',
    'AGENTS.md': 'How Foldkit is built.\n',
    '.claude/settings.json': '{}\n',
    '.claude/skills/release/SKILL.md': 'Cut a release.\n',
    '.claude-plugin/plugin.json': '{}\n',
    'packages/foldkit/CLAUDE.md': 'Package rules.\n',
    'packages/foldkit/src/index.ts': 'export const version = 1\n',
    'skills/generate-program/SKILL.md': 'Generate a program.\n',
    'examples/counter/src/main.ts': 'export const count = 0\n',
    [template]: 'Foldkit conventions, 1.0.0.\n',
  })

  git(project, 'init', '--quiet', '--initial-branch', 'main')
  write(project, {
    '.gitignore': 'node_modules/\n',
    'FOLDKIT.md': 'Foldkit conventions, from the scaffold.\n',
  })
  git(project, 'add', '--all')
  git(project, 'commit', '--quiet', '--message', 'chore: start')
  install('1.0.0')
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

const maintainerFiles = (paths: ReadonlyArray<string>) =>
  paths.filter(path =>
    /(^|\/)(CLAUDE\.md|\.claude|\.claude-plugin)(\/|$)/.test(path),
  )

describe('vendoring Foldkit', () => {
  test('adds the installed release under repos/foldkit as reading only', () => {
    const result = vendor()

    expect(result.status, result.output).toBe(0)
    expect(maintainerFiles(tracked())).toEqual([])
    expect(tracked()).toEqual(
      expect.arrayContaining([
        'repos/foldkit/AGENTS.md',
        'repos/foldkit/skills/generate-program/SKILL.md',
        'repos/foldkit/examples/counter/src/main.ts',
        'repos/foldkit/packages/foldkit/src/index.ts',
      ]),
    )
    expect(existsSync(join(project, 'repos/foldkit/CLAUDE.md'))).toBe(false)
    expect(existsSync(join(project, 'repos/foldkit/.claude'))).toBe(false)
    expect(read('FOLDKIT.md')).toBe('Foldkit conventions, 1.0.0.\n')
    expect(git(project, 'status', '--porcelain')).toBe('')
    expect(git(project, 'log', '--format=%s')).toContain('foldkit@1.0.0')
  })

  test('re-pins to a newer release, keeping the maintainer files out', () => {
    expect(vendor().status).toBe(0)
    release('1.1.0', {
      'CLAUDE.md': 'Foldkit maintainers: run our new checks.\n',
      '.claude/settings.json': '{ "changed": true }\n',
      'examples/counter/CLAUDE.md': 'A new nested guide.\n',
      'examples/stopwatch/src/main.ts': 'export const elapsed = 0\n',
      [template]: 'Foldkit conventions, 1.1.0.\n',
    })
    install('1.1.0')

    const result = vendor()

    expect(result.status, result.output).toBe(0)
    expect(maintainerFiles(tracked())).toEqual([])
    expect(tracked()).toContain('repos/foldkit/examples/stopwatch/src/main.ts')
    expect(read('FOLDKIT.md')).toBe('Foldkit conventions, 1.1.0.\n')
    expect(git(project, 'status', '--porcelain')).toBe('')
    expect(git(project, 'log', '--format=%s')).toContain('foldkit@1.1.0')
  })

  test('stops on a conflict outside the maintainer files, for a person', () => {
    expect(vendor().status).toBe(0)
    write(project, {
      'repos/foldkit/examples/counter/src/main.ts': 'export const count = 2\n',
    })
    git(project, 'commit', '--quiet', '--all', '--message', 'chore: edit')
    release('1.1.0', {
      'examples/counter/src/main.ts': 'export const count = 1\n',
    })
    install('1.1.0')

    const result = vendor()

    expect(result.status).not.toBe(0)
    expect(result.output).toContain('conflicts outside the maintainer files')
  })

  test('changes nothing when the subtree is already at the installed release', () => {
    expect(vendor().status).toBe(0)
    const head = git(project, 'rev-parse', 'HEAD')

    const result = vendor()

    expect(result.status, result.output).toBe(0)
    expect(git(project, 'rev-parse', 'HEAD')).toBe(head)
  })

  test('refuses to run on uncommitted changes', () => {
    write(project, { 'FOLDKIT.md': 'An edit not yet committed.\n' })

    const result = vendor()

    expect(result.status).not.toBe(0)
    expect(result.output).toContain('uncommitted')
    expect(existsSync(join(project, 'repos/foldkit'))).toBe(false)
  })
})
