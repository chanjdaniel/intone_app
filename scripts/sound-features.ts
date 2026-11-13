// Runs each sound model of docs/sounds.md on every voice fixture and keeps
// its frames in .cache/sounds/features/ (tests/support/sound-features.ts),
// for `npm run sounds:study`. Fetches each model into .cache/models/ once.
//
// `npm run sounds:features -- --model <id>` runs one model; `--shard i/n`
// runs every nth fixture from the ith, so several processes can share
// the work; a fixture whose frames are kept already is skipped.

import { parseArgs } from 'node:util'

import {
  fixtureSamples16k,
  hasSoundFeatures,
  writeSoundFeatures,
} from '../tests/support/sound-features.ts'
import {
  loadSoundModel,
  openSoundSession,
  runSoundModel,
  soundModel,
  soundModels,
} from '../tests/support/sound-models.ts'
import {
  conditions,
  fixtureId,
  phrases,
  variants,
  voices,
} from '../tests/support/voice-fixture-set.ts'

const { values } = parseArgs({
  options: {
    model: { type: 'string', multiple: true },
    shard: { type: 'string', default: '0/1' },
  },
})
const [shardIndex, shardCount] = (values.shard ?? '0/1').split('/').map(Number)
const models =
  values.model === undefined ? soundModels : values.model.map(soundModel)

const ids = phrases.flatMap(phrase =>
  voices.flatMap(voice =>
    variants.flatMap(variant =>
      conditions.map(condition =>
        fixtureId(phrase.id, voice.id, variant, condition),
      ),
    ),
  ),
)

for (const model of models) {
  const session = await openSoundSession(await loadSoundModel(model))
  let audioSeconds = 0
  let runSeconds = 0
  for (const [index, id] of ids.entries()) {
    if (index % (shardCount ?? 1) !== shardIndex || hasSoundFeatures(model, id))
      continue
    const samples = fixtureSamples16k(id)
    const started = process.hrtime.bigint()
    const features = await runSoundModel(model, session, samples)
    runSeconds += Number(process.hrtime.bigint() - started) / 1e9
    audioSeconds += samples.length / 16_000
    writeSoundFeatures(model, id, features)
  }
  await session.release()
  console.log(
    `${model.id}: ${audioSeconds.toFixed(1)} s of audio in ${runSeconds.toFixed(1)} s`,
  )
}
