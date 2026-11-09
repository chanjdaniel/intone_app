import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'

import { root, run } from '../support/run.ts'
import { hasSoundFeatures } from '../support/sound-features.ts'
import { soundModels } from '../support/sound-models.ts'
import {
  conditions,
  fixtureId,
  phrases,
  variants,
  voices,
} from '../support/voice-fixture-set.ts'

// docs/sounds-study.md is what `npm run sounds:study` writes from the
// models' frames, which only a machine that has run `npm run
// sounds:features` (about an hour on one thread, and 820 MB of models) keeps in
// .cache/sounds/: skipped where they are not all there, as CI is.

const featuresReady = soundModels.every(model =>
  phrases.every(phrase =>
    voices.every(voice =>
      variants.every(variant =>
        conditions.every(condition =>
          hasSoundFeatures(
            model,
            fixtureId(phrase.id, voice.id, variant, condition),
          ),
        ),
      ),
    ),
  ),
)

let scratch = ''

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'sounds-study-'))
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

test.skipIf(!featuresReady)(
  'docs/sounds-study.md is current, and no model passes the bar',
  () => {
    const out = join(scratch, 'sounds-study.md')
    const result = run('node', [
      '--import',
      './scripts/source-imports.ts',
      join(root, 'scripts', 'sounds-study.ts'),
      '--out',
      out,
    ])
    expect(result.status).toBe(0)
    expect(readFileSync(out, 'utf8')).toBe(
      readFileSync(join(root, 'docs', 'sounds-study.md'), 'utf8'),
    )
    // docs/sounds.md's verdict, which a passing model would overturn.
    for (const line of result.output.trim().split('\n')) {
      expect(line).toMatch(/fails/)
    }
  },
)
