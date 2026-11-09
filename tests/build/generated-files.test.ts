import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { root, run } from '../support/run'

// NOTICES.md and src/virtual-modules.d.ts are generated from the lockfile
// and models.json; CI runs the check that they are current.

let scratch = ''

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'generated-files-'))
  copyFileSync(
    join(root, 'package-lock.json'),
    join(scratch, 'package-lock.json'),
  )
  copyFileSync(join(root, 'models.json'), join(scratch, 'models.json'))
  mkdirSync(join(scratch, 'src'))
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

const generate = (...args: ReadonlyArray<string>) =>
  run('node', [join(root, 'build', 'generate.ts'), ...args])

describe('the generated files', () => {
  test('are current in the repository', () => {
    const result = generate('--check')

    expect(result.status, result.output).toBe(0)
  })

  test('NOTICES.md names each shipped package and model with its licence, and no dev-only package', () => {
    const notices = readFileSync(join(root, 'NOTICES.md'), 'utf8')
    const lockfile = JSON.parse(
      readFileSync(join(root, 'package-lock.json'), 'utf8'),
    )
    const ortVersion = lockfile.packages['node_modules/onnxruntime-web'].version

    expect(notices).toContain(`| onnxruntime-web | ${ortVersion} | MIT |`)
    expect(notices).toContain('| foldkit | 0.170.0 | MIT |')
    expect(notices).toContain('| effect | 4.1.2 | MIT |')
    expect(notices).toMatch(
      /\| SwiftF0 [^|]+ \| swift-f0\/model\.onnx \| MIT \| https:\/\/github\.com\/lars76\/swift-f0\//,
    )
    expect(notices).not.toContain('| vitest |')
    expect(notices).not.toContain('| vite |')
  })

  test('the check fails, naming the file, when a dependency changes until generate runs', () => {
    expect(generate('--root', scratch).status).toBe(0)
    expect(generate('--check', '--root', scratch).status).toBe(0)

    const lockfile = JSON.parse(
      readFileSync(join(scratch, 'package-lock.json'), 'utf8'),
    )
    lockfile.packages['node_modules/planted-by-generated-files'] = {
      version: '1.0.0',
      license: 'MIT',
    }
    writeFileSync(join(scratch, 'package-lock.json'), JSON.stringify(lockfile))

    const stale = generate('--check', '--root', scratch)
    expect(stale.status).toBe(1)
    expect(stale.output).toContain('Not current: NOTICES.md.')

    expect(generate('--root', scratch).status).toBe(0)
    expect(readFileSync(join(scratch, 'NOTICES.md'), 'utf8')).toContain(
      '| planted-by-generated-files | 1.0.0 | MIT |',
    )
  })

  test('the model ids type the model URL map', () => {
    expect(
      readFileSync(join(root, 'src', 'virtual-modules.d.ts'), 'utf8'),
    ).toContain("export type ModelId = 'swift-f0'")
  })
})
