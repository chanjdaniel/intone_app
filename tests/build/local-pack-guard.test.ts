import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { localPackFolder, localPackGuard } from '../../build/local-pack-guard'
import { chunksOf, productionBuild } from '../support/build'
import { run } from '../support/run'
import { root } from '../support/run'

// The local pack guard, through real production builds with the
// project's own config, the guard watching a planted pack folder: a
// module imported from it, an audio file imported from it, and a file of
// it copied into the public folder, under its own name and another, each
// fail the build, naming what came from the pack.

let planted = ''
let pack = ''

beforeAll(() => {
  planted = mkdtempSync(join(tmpdir(), 'local-pack-guard-'))
  pack = join(planted, 'local')
  mkdirSync(join(pack, 'audio'), { recursive: true })
  writeFileSync(
    join(pack, 'secret.ts'),
    "export const secret = 'a line from the local pack'\n",
  )
  copyFileSync(
    join(root, 'fixtures', 'voices', 'ame-ga-suki', 'zundamon', 'right.wav'),
    join(pack, 'audio', 'line.wav'),
  )
  writeFileSync(join(pack, 'pack.json'), '{ "version": 1 }\n')
})

afterAll(() => {
  rmSync(planted, { recursive: true, force: true })
})

// The guard, watching the planted pack, made once the pack is planted.
const guardingPlanted = () => ({
  'intone:local-pack-guard': localPackGuard(pack),
})

const plantEntry = (name: string, code: string): string => {
  const path = join(planted, name)
  writeFileSync(path, code)
  return path
}

const buildFrom = (input: string) =>
  productionBuild(
    {
      build: {
        write: false,
        rolldownOptions: { input, preserveEntrySignatures: 'strict' },
      },
    },
    guardingPlanted(),
  )

describe('the local pack guard', () => {
  test('watches local/, which git ignores', () => {
    expect(localPackFolder).toBe('local')
    expect(
      run('git', ['check-ignore', '--no-index', 'local/pack.json']).output,
    ).toBe('local/pack.json\n')
  })

  test('passes the real app, whose build holds nothing of a local pack', async () => {
    const output = await productionBuild(
      { build: { write: false } },
      guardingPlanted(),
    )

    expect(chunksOf(output).length).toBeGreaterThan(0)
  })

  test('fails a build that imports a module from the pack, naming it', async () => {
    const entry = plantEntry(
      'imports-the-pack.ts',
      "export { secret } from './local/secret.ts'\n",
    )

    await expect(buildFrom(entry)).rejects.toThrow(
      /Daniel's local pack \(.*\/local\/\) is in a production build:\n {2}assets\/imports-the-pack-[\w-]+\.js: .*local\/secret\.ts/,
    )
  })

  test('fails a build that imports an audio file from the pack', async () => {
    const entry = plantEntry(
      'imports-its-audio.ts',
      "export { default as line } from './local/audio/line.wav?url'\n",
    )

    await expect(buildFrom(entry)).rejects.toThrow(
      /\n {2}assets\/line-[\w-]+\.wav: .*local\/audio\/line\.wav/,
    )
  })

  test('fails a build whose public folder holds a copy of a file of the pack, under any name', async () => {
    const publicDir = join(planted, 'public')
    const outDir = join(planted, 'out')
    mkdirSync(publicDir, { recursive: true })
    writeFileSync(
      join(publicDir, 'renamed.bin'),
      readFileSync(join(pack, 'audio', 'line.wav')),
    )
    symlinkSync(join(pack, 'pack.json'), join(publicDir, 'linked.json'))

    await expect(
      productionBuild(
        { publicDir, build: { outDir, emptyOutDir: true } },
        guardingPlanted(),
      ),
    ).rejects.toThrow(
      /\n {2}linked\.json: the bytes of .*local\/pack\.json\n {2}renamed\.bin: the bytes of .*local\/audio\/line\.wav/,
    )
  })
})
