import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  test('measures the module script the built page loads', async () => {
    const size = await entryChunkSize(dist)
    const html = readFileSync(join(dist, 'index.html'), 'utf8')

    expect(html).toContain(
      `<script type="module" crossorigin src="/${size.file}">`,
    )
    expect(size.gzipBytes).toBe(
      gzipSync(readFileSync(join(dist, size.file)), { level: 9 }).length,
    )
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
