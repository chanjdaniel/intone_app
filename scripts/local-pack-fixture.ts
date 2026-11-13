// Writes fixtures/local-pack/: a small example of Daniel's local pack
// (docs/local-pack.md) for the tests, made from fixtures already here, so
// nothing of the real local/ folder is ever needed or committed. Two
// VOICEVOX phrases, each a whole file with its text, one with its kana
// and a planted YouTube link, and the first 8 s of a LibriVox CC0 reading
// with two lines of it and no text, one with a link to its source.
// `npm run fixtures:local-pack`; `--out <dir>` writes elsewhere. The same
// bytes every run.

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import { decodeWav, encodeWav } from '../src/engine/audio/wav.ts'

const root = join(import.meta.dirname, '..')
const { values } = parseArgs({
  options: {
    out: { type: 'string', default: join(root, 'fixtures', 'local-pack') },
  },
})
const out = values.out

// A link the app must never fetch: the end-to-end test watches for any
// request to its host.
export const plantedSourceUrl =
  'https://www.youtube.com/watch?v=intone-local-pack-fixture'

const readingSeconds = 8

const voice = (phrase: string) =>
  join(root, 'fixtures', 'voices', phrase, 'meimei-himari', 'right.wav')

const reading = join(root, 'fixtures', 'real', 'gongitsune.wav')

// Where the reading's stretch starts in the LibriVox chapter, in seconds
// (fixtures/real/gongitsune.json).
const readingFrom = 655_988 / 22_050

const at = (seconds: number): number => Math.round(seconds * 100) / 100

export const manifest = {
  version: 1,
  id: 'example',
  name: 'Example local pack',
  lines: [
    {
      file: 'audio/hashi.wav',
      text: '橋を渡ります',
      kana: 'はしをわたります',
      source: { url: plantedSourceUrl, start: 12.5, end: 14.1 },
    },
    {
      file: 'audio/kyou.wav',
      text: '今日は駅で古い友達に会いました',
    },
    {
      file: 'audio/gongitsune.wav',
      start: 0.68,
      end: 3.69,
      source: {
        url: 'https://archive.org/details/gongitsune_um_librivox',
        start: at(readingFrom + 0.68),
        end: at(readingFrom + 3.69),
      },
    },
    { file: 'audio/gongitsune.wav', start: 3.79, end: 6.7 },
  ],
}

mkdirSync(join(out, 'audio'), { recursive: true })
copyFileSync(voice('hashi-o-watarimasu'), join(out, 'audio', 'hashi.wav'))
copyFileSync(voice('kyou-wa-eki-de'), join(out, 'audio', 'kyou.wav'))
const whole = decodeWav(readFileSync(reading))
writeFileSync(
  join(out, 'audio', 'gongitsune.wav'),
  encodeWav({
    sampleRate: whole.sampleRate,
    encoding: 'pcm16',
    channels: whole.channels.map(channel =>
      channel.slice(0, Math.round(readingSeconds * whole.sampleRate)),
    ),
  }),
)
writeFileSync(join(out, 'pack.json'), `${JSON.stringify(manifest, null, 2)}\n`)
