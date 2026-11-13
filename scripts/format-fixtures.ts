// Writes fixtures/formats/: one stretch of a LibriVox CC0 clip
// (fixtures/real/gongitsune.wav, its first 4 s) in each audio format a
// learner may bring, for tests/e2e/uploads.spec.ts, which tries each in the
// browser and records which decode (docs/uploads.md). `npm run
// fixtures:formats`; `--out <dir>` writes elsewhere. Needs ffmpeg; the
// encoders' output can change with its version, so the files are made
// once and committed, and a test remakes them only where the same
// version is installed.

import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const root = join(import.meta.dirname, '..')
const { values } = parseArgs({
  options: {
    out: { type: 'string', default: join(root, 'fixtures', 'formats') },
  },
})

// The ffmpeg the committed files were made with.
export const formatsFfmpeg = 'ffmpeg version n9.0.2'

const source = join(root, 'fixtures', 'real', 'gongitsune.wav')
const seconds = 4

// Each format: its file name, what it is, and ffmpeg's arguments for it.
// Every one is stereo at 44.1 kHz, as a recording off a phone or a
// computer usually is, except where the format itself says otherwise.
export const formats: ReadonlyArray<
  Readonly<{ file: string; what: string; args: ReadonlyArray<string> }>
> = [
  { file: 'pcm16.wav', what: 'WAV, 16-bit PCM', args: ['-c:a', 'pcm_s16le'] },
  { file: 'pcm24.wav', what: 'WAV, 24-bit PCM', args: ['-c:a', 'pcm_s24le'] },
  {
    file: 'float32.wav',
    what: 'WAV, 32-bit float',
    args: ['-c:a', 'pcm_f32le'],
  },
  {
    file: 'mp3.mp3',
    what: 'MP3, 128 kbit/s',
    args: ['-c:a', 'libmp3lame', '-b:a', '128k'],
  },
  {
    file: 'aac.m4a',
    what: 'M4A, AAC-LC',
    args: ['-c:a', 'aac', '-b:a', '128k'],
  },
  { file: 'alac.m4a', what: 'M4A, Apple Lossless', args: ['-c:a', 'alac'] },
  { file: 'flac.flac', what: 'FLAC', args: ['-c:a', 'flac'] },
  {
    file: 'vorbis.ogg',
    what: 'Ogg Vorbis',
    args: ['-c:a', 'libvorbis', '-q:a', '4'],
  },
  {
    file: 'opus.ogg',
    what: 'Ogg Opus (48 kHz)',
    args: ['-c:a', 'libopus', '-b:a', '96k', '-ar', '48000'],
  },
  {
    file: 'opus.webm',
    what: 'WebM Opus (48 kHz)',
    args: ['-c:a', 'libopus', '-b:a', '96k', '-ar', '48000'],
  },
  { file: 'aiff.aiff', what: 'AIFF, 16-bit PCM', args: ['-c:a', 'pcm_s16be'] },
]

const ffmpeg = (args: ReadonlyArray<string>): void => {
  const result = spawnSync('ffmpeg', ['-v', 'error', ...args])
  if (result.status !== 0) {
    throw new Error(`ffmpeg ${args.join(' ')}: ${result.stderr.toString()}`)
  }
}

const version = /^ffmpeg version \S+/.exec(
  spawnSync('ffmpeg', ['-version']).stdout.toString(),
)?.[0]
if (version !== formatsFfmpeg) {
  throw new Error(
    `These files are made with ${formatsFfmpeg}; found ${version ?? 'none'}.`,
  )
}

mkdirSync(values.out, { recursive: true })
formats.forEach(({ file, args }) => {
  ffmpeg([
    '-y',
    '-i',
    source,
    '-t',
    String(seconds),
    '-ac',
    '2',
    '-ar',
    '44100',
    // No encoder name or date in the file, so a remake is the same bytes.
    '-map_metadata',
    '-1',
    '-fflags',
    '+bitexact',
    '-flags:a',
    '+bitexact',
    ...args,
    join(values.out, file),
  ])
})
writeFileSync(
  join(values.out, 'formats.json'),
  `${JSON.stringify(
    {
      source: 'fixtures/real/gongitsune.wav (LibriVox, CC0 1.0)',
      seconds,
      ffmpeg: formatsFfmpeg,
      formats: formats.map(({ file, what }) => ({ file, what })),
    },
    null,
    1,
  )}\n`,
)
