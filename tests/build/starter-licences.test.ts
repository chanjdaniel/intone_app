import { Schema } from 'effect'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'

import { StarterList, StarterPack } from '../../src/services/starter-records.ts'
import { root } from '../support/run'
import { audioExtensions } from '../support/starter-pack.ts'

// Nothing whose licence does not allow it is committed (spec, "Content
// and licences"): every recording under starter/ is a line of the pack,
// whose record names its source, its author and a licence from the list
// the set allows, the list itself says the same of every recording, and a
// record outside that list does not decode. The production build's own
// test (./production-build.test.ts) checks what the build bundles.

const sha256 = (bytes: Buffer): string =>
  createHash('sha256').update(bytes).digest('hex')

const starterDir = join(root, 'starter')

const readJson = (path: string): unknown =>
  JSON.parse(readFileSync(path, 'utf8'))

describe('the starter set’s recordings', () => {
  const pack = Schema.decodeUnknownSync(StarterPack)(
    readJson(join(starterDir, 'pack', 'levels.json')),
  )
  const list = Schema.decodeUnknownSync(StarterList)(
    readJson(join(starterDir, 'lines.json')),
  )
  const lines = pack.levels.flatMap(level => level.lines)

  test('are each a line of the pack, by its bytes, credited with its source, author and licence', () => {
    const audio = readdirSync(starterDir, {
      recursive: true,
      withFileTypes: true,
    })
      .filter(entry => entry.isFile() && audioExtensions.test(entry.name))
      .map(entry => join(entry.parentPath, entry.name))
    expect(audio.length).toBe(lines.length)
    for (const path of audio) {
      const named = relative(join(starterDir, 'pack'), path)
      const line = lines.find(found => found.audio === named)
      expect(line, named).toBeDefined()
      expect(sha256(readFileSync(path)), named).toBe(line?.sha256)
      expect(line?.credit.author.trim(), named).not.toBe('')
    }
  })

  test('are each in the list with what made them, and only a Commons, LibriVox or VOICEVOX recording', () => {
    for (const line of lines) {
      const listed = list.lines.find(found => found.id === line.id)
      expect(listed, line.id).toBeDefined()
      expect(['Commons', 'LibriVox', 'Voicevox']).toContain(
        listed?.recording.kind,
      )
    }
  })

  const commons = {
    kind: 'Commons',
    file: 'File:A.wav',
    page: 'https://commons.wikimedia.org/wiki/File:A.wav',
    url: 'https://upload.wikimedia.org/wikipedia/commons/a/a0/A.wav',
    bytes: 10,
    sha256: '0'.repeat(64),
    author: 'Someone',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0',
  }
  const listWith = (recording: unknown) => ({
    version: 1,
    levels: [{ id: 'starter-heiban', kind: 'Heiban', name: 'H', about: 'A' }],
    lines: [
      {
        id: 'a',
        level: 'starter-heiban',
        text: '水が',
        kana: 'みずが',
        words: [{ text: '水', kana: 'みず', accentType: 0, particle: 'が' }],
        recording,
        review: { verdict: 'unreviewed' },
      },
    ],
  })
  const decodes = (recording: unknown): boolean =>
    Schema.decodeUnknownOption(StarterList)(listWith(recording))._tag === 'Some'

  test('refuse a recording with a licence outside the list, or no author or source', () => {
    expect(decodes(commons)).toBe(true)
    expect(decodes({ ...commons, licence: 'CC BY-SA 4.0' })).toBe(true)
    expect(decodes({ ...commons, licence: 'CC0' })).toBe(true)
    for (const licence of [
      'CC BY-NC 4.0',
      'CC BY-ND 4.0',
      'Public domain',
      'GFDL',
      '',
    ]) {
      expect(decodes({ ...commons, licence }), licence).toBe(false)
    }
    expect(decodes({ ...commons, author: '' })).toBe(false)
    const { page: _, ...noPage } = commons
    expect(decodes(noPage)).toBe(false)
    const { licenceUrl: __, ...noLicenceUrl } = commons
    expect(decodes(noLicenceUrl)).toBe(false)
    expect(decodes({ kind: 'Voicevox', voice: 'meimei-himari' })).toBe(true)
    expect(decodes({ kind: 'Voicevox', voice: 'kasukabe-tsumugi' })).toBe(false)
    expect(
      decodes({ kind: 'YouTube', url: 'https://www.youtube.com/watch?v=x' }),
    ).toBe(false)
    expect(
      decodes({
        ...commons,
        kind: 'LibriVox',
        licence: 'Public domain',
        from: 0,
        to: 1,
      }),
    ).toBe(true)
    expect(
      decodes({
        ...commons,
        kind: 'LibriVox',
        licence: 'CC BY 4.0',
        from: 0,
        to: 1,
      }),
    ).toBe(false)
  })
})
