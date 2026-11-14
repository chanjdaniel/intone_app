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

import { type Run, root, run as runCommand } from '../support/run'

// scripts/vendor-foldkit.sh run against a stand-in for Foldkit's repository:
// a local git repository with the same maintainer files, tagged the way
// Foldkit tags its releases.

const script = join(root, 'scripts', 'vendor-foldkit.sh')

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

const run = (
  cwd: string,
  command: string,
  args: ReadonlyArray<string>,
  environment: Record<string, string> = {},
): Run =>
  runCommand(command, args, { cwd, env: { ...gitEnvironment, ...environment } })

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

const pinFile = 'scripts/vendor-foldkit.pin'

const tagCommit = (version: string): string =>
  git(upstream, 'rev-parse', `foldkit@${version}^{commit}`)

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
    '.agents/skills/release-version/SKILL.md': 'Release Foldkit.\n',
    'repos/effect/packages/effect/src/Effect.ts': 'export const v = 1\n',
    '.github/workflows/deploy-website.yml': 'on: push\n',
    'examples/pixel-art/vercel.json': '{}\n',
    'packages/typing-game/client/vercel.json': '{}\n',
    'packages/typing-game/client/.env.example': 'API_KEY=\n',
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

// What the script must drop: anything that loads as instructions in an agent
// session, Foldkit's own vendored repos/, and its CI, deploy and secrets
// files, which would never run here but look like this project's own.
const dropped = (paths: ReadonlyArray<string>) =>
  paths.filter(
    path =>
      path.startsWith('repos/foldkit/repos/') ||
      /(^|\/)(CLAUDE\.md|\.claude|\.claude-plugin|\.agents|\.github|vercel\.json|\.env[^/]*)(\/|$)/.test(
        path,
      ),
  )

describe('vendoring Foldkit', () => {
  test('adds the installed release under repos/foldkit as reading only', () => {
    const result = vendor()

    expect(result.status, result.output).toBe(0)
    expect(dropped(tracked())).toEqual([])
    expect(tracked()).toEqual(
      expect.arrayContaining([
        'repos/foldkit/AGENTS.md',
        'repos/foldkit/skills/generate-program/SKILL.md',
        'repos/foldkit/examples/counter/src/main.ts',
        'repos/foldkit/packages/foldkit/src/index.ts',
      ]),
    )
    for (const path of ['CLAUDE.md', '.claude', '.claude-plugin', '.agents']) {
      expect(existsSync(join(project, 'repos/foldkit', path)), path).toBe(false)
    }
    expect(existsSync(join(project, 'repos/foldkit/repos'))).toBe(false)
    expect(read('FOLDKIT.md')).toBe('Foldkit conventions, 1.0.0.\n')
    expect(git(project, 'status', '--porcelain')).toBe('')
    expect(git(project, 'log', '--format=%s')).toContain('foldkit@1.0.0')
  })

  test("pins the release tag's commit beside the script", () => {
    const result = vendor()

    expect(result.status, result.output).toBe(0)
    expect(read(pinFile)).toBe(`foldkit@1.0.0 ${tagCommit('1.0.0')}\n`)
    expect(git(project, 'show', '--format=%b', '--no-patch')).toContain(
      tagCommit('1.0.0'),
    )
  })

  test('refuses a release tag that names another commit than its pin', () => {
    expect(vendor().status).toBe(0)
    const pinned = tagCommit('1.0.0')
    const head = git(project, 'rev-parse', 'HEAD')
    // Upstream moves the tag onto another tree.
    write(upstream, {
      'examples/counter/src/main.ts': 'export const count = 9\n',
    })
    git(upstream, 'commit', '--quiet', '--all', '--message', 'retag')
    git(upstream, 'tag', '--force', 'foldkit@1.0.0')
    const moved = tagCommit('1.0.0')

    const result = vendor()

    expect(result.status).not.toBe(0)
    expect(result.output).toContain(pinned)
    expect(result.output).toContain(moved)
    expect(git(project, 'rev-parse', 'HEAD')).toBe(head)
    expect(git(project, 'status', '--porcelain')).toBe('')
    expect(read('repos/foldkit/examples/counter/src/main.ts')).toBe(
      'export const count = 0\n',
    )
  })

  // A pin edited by hand: empty, missing its commit or with a short one, or
  // naming a tag that is no release's.
  for (const [name, pin] of [
    ['empty', () => ''],
    ['with no commit', () => 'foldkit@1.0.0\n'],
    ['with a short commit', () => 'foldkit@1.0.0 abc123\n'],
    ['naming no release', () => `foldkit@1.0.00 ${tagCommit('1.0.0')}\n`],
  ] as const) {
    test(`refuses a pin ${name}, naming it`, () => {
      expect(vendor().status).toBe(0)
      write(project, { [pinFile]: pin() })
      git(project, 'commit', '--quiet', '--all', '--message', 'chore: pin')
      const head = git(project, 'rev-parse', 'HEAD')

      const result = vendor()

      expect(result.status).not.toBe(0)
      expect(result.output).toContain(pinFile)
      expect(git(project, 'rev-parse', 'HEAD')).toBe(head)
      expect(git(project, 'status', '--porcelain')).toBe('')
    })
  }

  test('reads a pin with no final newline', () => {
    expect(vendor().status).toBe(0)
    write(project, { [pinFile]: `foldkit@1.0.0 ${tagCommit('1.0.0')}` })
    git(project, 'commit', '--quiet', '--all', '--message', 'chore: pin')

    const result = vendor()

    expect(result.status, result.output).toBe(0)
  })

  test('says so when it re-pins from another release', () => {
    expect(vendor().status).toBe(0)
    release('1.1.0', { [template]: 'Foldkit conventions, 1.1.0.\n' })
    install('1.1.0')

    const result = vendor()

    expect(result.status, result.output).toBe(0)
    expect(result.output).toContain(
      `foldkit@1.1.0 at ${tagCommit('1.1.0')}, replacing foldkit@1.0.0 at ${tagCommit('1.0.0')}`,
    )
  })

  test('re-pins to a newer release, keeping the dropped files out', () => {
    expect(vendor().status).toBe(0)
    release('1.1.0', {
      'CLAUDE.md': 'Foldkit maintainers: run our new checks.\n',
      '.claude/settings.json': '{ "changed": true }\n',
      'examples/counter/CLAUDE.md': 'A new nested guide.\n',
      '.agents/skills/release-version/SKILL.md': 'Release Foldkit, v2.\n',
      'repos/effect/packages/effect/src/Effect.ts': 'export const v = 2\n',
      'examples/stopwatch/src/main.ts': 'export const elapsed = 0\n',
      [template]: 'Foldkit conventions, 1.1.0.\n',
    })
    install('1.1.0')

    const result = vendor()

    expect(result.status, result.output).toBe(0)
    expect(dropped(tracked())).toEqual([])
    expect(tracked()).toContain('repos/foldkit/examples/stopwatch/src/main.ts')
    expect(read('FOLDKIT.md')).toBe('Foldkit conventions, 1.1.0.\n')
    expect(git(project, 'status', '--porcelain')).toBe('')
    expect(git(project, 'log', '--format=%s')).toContain('foldkit@1.1.0')
    expect(read(pinFile)).toBe(`foldkit@1.1.0 ${tagCommit('1.1.0')}\n`)
  })

  test('re-pins after a squash merge flattened the subtree history', () => {
    expect(vendor().status).toBe(0)
    // What a squash or rebase merge of the pull request leaves: the same
    // tree, with none of git subtree's own commits in the history.
    git(project, 'checkout', '--quiet', '--orphan', 'flattened')
    git(project, 'commit', '--quiet', '--message', 'feat: squash-merged')
    release('1.1.0', {
      'examples/stopwatch/src/main.ts': 'export const elapsed = 0\n',
      [template]: 'Foldkit conventions, 1.1.0.\n',
    })
    install('1.1.0')

    const result = vendor()

    expect(result.status, result.output).toBe(0)
    expect(dropped(tracked())).toEqual([])
    expect(tracked()).toContain('repos/foldkit/examples/stopwatch/src/main.ts')
    expect(read('FOLDKIT.md')).toBe('Foldkit conventions, 1.1.0.\n')
    expect(git(project, 'status', '--porcelain')).toBe('')
  })

  test('re-pins over a local edit inside the subtree, which is reading only', () => {
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

    expect(result.status, result.output).toBe(0)
    expect(read('repos/foldkit/examples/counter/src/main.ts')).toBe(
      'export const count = 1\n',
    )
    expect(git(project, 'status', '--porcelain')).toBe('')
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
