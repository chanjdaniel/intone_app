import examplePack from '../../../fixtures/local-pack/pack.json?raw'
import { PackImportError, readManifest } from '../../services/local-pack'
import { type LevelClip, levelClipOf } from '../level/level'

// The example local pack the tests import (fixtures/local-pack/), as its
// level shows it once imported, for the dev library: its manifest read
// by the app's own Schema, each whole-file line as long as its file.

const fileSeconds: Readonly<Record<string, number>> = {
  'audio/hashi.wav': 1.632,
  'audio/kyou.wav': 3.402667,
  'audio/gongitsune.wav': 8,
}

const manifest = readManifest(examplePack)

export const examplePackClip: LevelClip =
  manifest instanceof PackImportError
    ? levelClipOf({
        format: 1,
        id: 'pack-example',
        name: manifest.reason,
        addedAt: 0,
        seconds: 0,
        audio: null,
        lines: [],
      })
    : levelClipOf({
        format: 1,
        id: 'pack-example',
        name: manifest.name,
        addedAt: 0,
        seconds: 13.03,
        audio: null,
        lines: manifest.lines.map((line, k) => ({
          id: String(k + 1),
          file: line.file,
          from: line.start ?? 0,
          to: line.end ?? fileSeconds[line.file] ?? 0,
          native: { _tag: 'Tracked', nativeId: `n${k + 1}` },
          ...(line.text === undefined ? {} : { text: line.text }),
          ...(line.kana === undefined ? {} : { kana: line.kana }),
          ...(line.source === undefined
            ? {}
            : {
                source: {
                  url: line.source.url,
                  ...(line.source.start === undefined
                    ? {}
                    : { from: line.source.start }),
                  ...(line.source.end === undefined
                    ? {}
                    : { to: line.source.end }),
                },
              }),
        })),
        pack: {
          id: manifest.id,
          files: Object.entries(fileSeconds).map(([path, seconds], k) => ({
            path,
            sha256: String(k).repeat(64),
            seconds,
            audio: {
              file: `clips/pack-example-${String(k).repeat(16)}.wav`,
              type: 'audio/wav',
              bytes: 1,
            },
          })),
        },
      })
