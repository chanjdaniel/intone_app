// Writes the synthetic voices, each a 48 kHz 16-bit mono WAV and its
// labels, to fixtures/synthetic/, or to the directory after --out.
// `npm run fixtures:synthetic`; tests/scripts/synthetic-voices.test.ts
// checks the committed files are what this writes, byte for byte.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import { encodeWav } from '../src/engine/audio/wav.ts'
import { synthesiseVoice, voiceNames } from '../tests/support/synthetic-voice.ts'

const fixtureSampleRate = 48000

const { values } = parseArgs({
  options: {
    out: {
      type: 'string',
      default: join(import.meta.dirname, '..', 'fixtures', 'synthetic'),
    },
  },
})

mkdirSync(values.out, { recursive: true })
for (const name of voiceNames) {
  const { samples, labels } = synthesiseVoice(name, fixtureSampleRate)
  writeFileSync(
    join(values.out, `${name}.wav`),
    encodeWav({
      sampleRate: fixtureSampleRate,
      encoding: 'pcm16',
      channels: [samples],
    }),
  )
  writeFileSync(
    join(values.out, `${name}.json`),
    `${JSON.stringify(labels, null, 2)}\n`,
  )
}
