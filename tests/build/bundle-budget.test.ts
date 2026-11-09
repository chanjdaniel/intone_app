import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { entryChunkSize, readBudget } from '../../build/bundle-budget.ts'
import { productionBuild } from '../support/build'
import { root, run } from '../support/run'

// The bundle budget, read with the budget script's own reader from a real
// production build.

let dist = ''

beforeAll(async () => {
  dist = mkdtempSync(join(tmpdir(), 'bundle-budget-'))
  await productionBuild({ build: { outDir: dist, emptyOutDir: true } })
})

afterAll(() => {
  rmSync(dist, { recursive: true, force: true })
})

const budgetScript = (budget: string) =>
  run('node', ['build/bundle-budget.ts', '--dist', dist, '--budget', budget])

describe('the bundle budget', () => {
  test('measures the module script the built page loads, and every chunk it imports at start', async () => {
    const size = await entryChunkSize(dist)
    const html = readFileSync(join(dist, 'index.html'), 'utf8')

    expect(html).toContain(
      `<script type="module" crossorigin src="/${size.file}">`,
    )
    expect(size.gzipBytes).toBe(
      [size.file, ...size.imports].reduce(
        (total, file) =>
          total + gzipSync(readFileSync(join(dist, file)), { level: 9 }).length,
        0,
      ),
    )
  })

  test('counts the chunks the entry imports statically, through each other, and never a lazy one', async () => {
    const planted = mkdtempSync(join(tmpdir(), 'bundle-budget-planted-'))
    try {
      mkdirSync(join(planted, 'assets'))
      writeFileSync(
        join(planted, 'index.html'),
        '<script type="module" crossorigin src="/assets/index-a.js"></script>',
      )
      const files = {
        'index-a.js':
          'import{t as e}from"./shared-b.js";import"./side-c.js";const l=()=>import("./lazy-d.js");export{e,l}',
        'shared-b.js': 'export{t}from"./deep-e.js"',
        'side-c.js': 'console.log("side")',
        'lazy-d.js': 'export const lazy=1'.repeat(200),
        'deep-e.js': 'export const t=1',
      }
      Object.entries(files).forEach(([name, code]) =>
        writeFileSync(join(planted, 'assets', name), code),
      )
      const gzipOf = (name: keyof typeof files) =>
        gzipSync(files[name], { level: 9 }).length

      const size = await entryChunkSize(planted)

      expect(size.file).toBe('assets/index-a.js')
      expect([...size.imports].sort()).toEqual([
        'assets/deep-e.js',
        'assets/shared-b.js',
        'assets/side-c.js',
      ])
      expect(size.gzipBytes).toBe(
        gzipOf('index-a.js') +
          gzipOf('shared-b.js') +
          gzipOf('side-c.js') +
          gzipOf('deep-e.js'),
      )
    } finally {
      rmSync(planted, { recursive: true, force: true })
    }
  })

  test("the project's entry chunk is within its budget", async () => {
    const result = budgetScript(join(root, 'bundle-budget.json'))
    const budget = await readBudget(join(root, 'bundle-budget.json'))
    const size = await entryChunkSize(dist)

    expect(result.status, result.output).toBe(0)
    expect(size.gzipBytes).toBeLessThanOrEqual(budget.entry.gzipBytes)
  })

  test('fails above the budget, naming the chunk and by how much', async () => {
    const tight = join(dist, 'tight-budget.json')
    writeFileSync(tight, JSON.stringify({ entry: { gzipBytes: 1000 } }))
    const size = await entryChunkSize(dist)

    const result = budgetScript(tight)

    expect(result.status).toBe(1)
    expect(result.output).toContain(
      `Entry chunk ${size.file}: ${size.gzipBytes} B gzip, budget 1000 B: over by ${size.gzipBytes - 1000} B`,
    )
  })
})
