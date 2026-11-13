// Writes fixtures/tracked/: every fixture's curve and spectral features,
// as the app makes them (tests/support/tracked-fixtures.ts), for the
// score's tests and its study (docs/score.md). Needs SwiftF0, fetched into
// .cache/models/ once.
//
// `npm run fixtures:tracked`; `--out <dir>` writes elsewhere. Run with
// `node --import ./scripts/source-imports.ts`, which the npm script does,
// so the app's own source loads under Node.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'

import { loadSwiftF0Model, withSwiftF0 } from '../tests/support/swift-f0.ts'
import {
  encodeTracked,
  fixtureSources,
  trackFixture,
  trackedDirectory,
  trackedPathOf,
} from '../tests/support/tracked-fixtures.ts'

const root = join(import.meta.dirname, '..')

const { values } = parseArgs({
  options: { out: { type: 'string', default: trackedDirectory } },
})
const out = values.out ?? trackedDirectory

rmSync(out, { recursive: true, force: true })
const model = await loadSwiftF0Model()
await withSwiftF0(model, async infer => {
  for (const source of fixtureSources()) {
    const tracked = await trackFixture(
      source,
      readFileSync(join(root, 'fixtures', source)),
      infer,
    )
    const path = join(out, trackedPathOf(source))
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, encodeTracked(tracked))
  }
})
