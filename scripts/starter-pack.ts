// Writes the starter pack (docs/starter-set.md) from its source list,
// starter/lines.json: starter/pack/levels.json, the level data the app
// imports, starter/pack/audio/<line>.wav, each line's file,
// starter/pack/files.json, each file's SHA-256 and what it was made
// from, which this script alone reads, and CREDITS.md, the same bytes
// every run.
//
// `npm run starter:pack` writes them. A line's file is made only when
// what it is made from has changed (its `made` key in files.json):
// a Commons file downloaded at its pinned URL into the git-ignored
// .cache/starter/, checked by size and SHA-256, mixed to mono and
// resampled to 24 kHz; a VOICEVOX line synthesised by VOICEVOX CORE,
// set up by `npm run fixtures:voices-setup`, with its pitch set from the
// stated accent. Otherwise the file already in the pack is kept.
//
// - `--check` writes nothing and fails, naming each file, when the pack
//   or CREDITS.md is not what the list makes, or a line must be remade;
// - `--remake` makes every file again, which with `--check` proves the
//   committed files are what their sources make;
// - `--commons` reads each Commons file's author, licence and URL from
//   Commons' own metadata, and pins its size and SHA-256 in the list;
// - `--accents` writes into the list what UniDic 2023.02 (its compiled
//   lexicon, fetched once into .cache/unidic/) and Wiktionary give for
//   each word, and each line's flag where they disagree;
// - `--apply <file>` writes the review page's export into the list.

import { Schema } from 'effect'
import { unzipSync } from 'fflate'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { parseArgs } from 'node:util'

import { decodeWav } from '../src/engine/audio/wav.ts'
import {
  ReviewExport,
  StarterList,
  type StarterListLine,
  StarterPack,
  StarterPackFiles,
} from '../src/services/starter-records.ts'
import { toMono } from '../tests/support/fixture-audio.ts'
import {
  applyReview,
  audioPathOf,
  convertRecording,
  creditsMarkdown,
  lineFlag,
  listProblems,
  packFilesOf,
  packOf,
  packSampleRate,
  packWav,
  recipeOf,
  unidicAccents,
  unidicFeatures,
  voiceOf,
  voicevoxKana,
  wiktionaryAccents,
} from '../tests/support/starter-pack.ts'
import {
  accentPitches,
  leadSeconds,
  tailSeconds,
} from '../tests/support/voice-fixtures.ts'
import type { AudioQuery } from '../tests/support/voicevox-query.ts'

const root = join(import.meta.dirname, '..')

const { values } = parseArgs({
  options: {
    check: { type: 'boolean', default: false },
    remake: { type: 'boolean', default: false },
    commons: { type: 'boolean', default: false },
    accents: { type: 'boolean', default: false },
    apply: { type: 'string' },
    root: { type: 'string' },
  },
})

// `--root` points the script at another copy of the repository's
// starter/ and CREDITS.md, as the tests do.
const base = values.root ?? root
const listPath = join(base, 'starter', 'lines.json')
const packDir = join(base, 'starter', 'pack')
const levelsPath = join(packDir, 'levels.json')
const filesPath = join(packDir, 'files.json')
const creditsPath = join(base, 'CREDITS.md')
const sourcesCache = join(root, '.cache', 'starter')
const unidicCache = join(root, '.cache', 'unidic')
const voicevoxCache = join(root, '.cache', 'voicevox')
const python = join(root, '.venv', 'bin', 'python')

// UniDic 2023.02, 現代書き言葉UniDic for MeCab, under GPL, LGPL or BSD
// (its license/COPYING); only its compiled lexicon is read.
const unidic = {
  url: 'https://clrd.ninjal.ac.jp/unidic_archive/2302/unidic-cwj-202302.zip',
  bytes: 603549853,
  sha256: '601bc4b0af794d3c20c2089771b8771209390e1b35b0f20c85cf0a10c9a98c6d',
  dictionary: 'sys.dic',
  dictionarySha256:
    '048f93a7f6aed6dd1c108cdd7b947a0f3a5a3d0d1012dd1f7d3c7b133b5867d7',
}

// Commons and Wiktionary ask automated clients to name themselves.
const userAgent = 'starter-pack-script/1.0 (build script; Node fetch)'

const sha256Of = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex')

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

const writeFile = (path: string, bytes: Uint8Array | string): void => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, bytes)
}

const readList = (): StarterList =>
  Schema.decodeUnknownSync(StarterList)(
    JSON.parse(readFileSync(listPath, 'utf8')),
  )

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms))

// A JSON answer from an API, as text, asked again after a pause when it
// answers too many requests.
const fetchJsonText = async (url: URL): Promise<string> => {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, { headers: { 'user-agent': userAgent } })
    const text = await response.text()
    if (response.ok && text.startsWith('{')) return text
    if (attempt === 6) throw new Error(`${url.host}: HTTP ${response.status}`)
    await sleep(5000 * attempt)
  }
}

// A file's bytes, asked again after the pause the server names when it
// answers too many requests.
const fetchBytes = async (url: string): Promise<Uint8Array> => {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, { headers: { 'user-agent': userAgent } })
    if (response.ok) return new Uint8Array(await response.arrayBuffer())
    if (response.status !== 429 || attempt === 6) {
      throw new Error(`${url}: HTTP ${response.status}`)
    }
    const after = Number(response.headers.get('retry-after'))
    await sleep(
      Number.isFinite(after) && after > 0 ? after * 1000 : 10000 * attempt,
    )
  }
}

// A downloaded file from the cache, fetched first when it is missing,
// and refused unless it has its pinned size and SHA-256.
const cachedDownload = async (
  file: Readonly<{ url: string; bytes: number; sha256: string }>,
  offline: boolean,
): Promise<Uint8Array> => {
  const path = join(
    sourcesCache,
    file.sha256,
    decodeURIComponent(basename(file.url)),
  )
  if (existsSync(path)) {
    const bytes = readFileSync(path)
    if (sha256Of(bytes) === file.sha256) return bytes
  }
  if (offline) throw new Error(`${file.url} is not in .cache/starter/`)
  const bytes = await fetchBytes(file.url)
  if (bytes.length !== file.bytes || sha256Of(bytes) !== file.sha256) {
    throw new Error(
      `${file.url}: ${bytes.length} B, SHA-256 ${sha256Of(bytes)}; the list pins ${file.bytes} B, ${file.sha256}`,
    )
  }
  writeFile(path, bytes)
  return bytes
}

type Request =
  | Readonly<{ query: string; style: number; model: string }>
  | Readonly<{
      synthesise: AudioQuery
      style: number
      model: string
      out: string
    }>

// One run of the VOICEVOX bridge (scripts/voicevox/synthesise.py).
const voicevox = (
  requests: ReadonlyArray<Request>,
): ReadonlyArray<{ query?: AudioQuery }> => {
  if (!existsSync(python) || !existsSync(join(voicevoxCache, 'models'))) {
    throw new Error(
      'VOICEVOX CORE is not set up here: run `npm run fixtures:voices-setup` first.',
    )
  }
  const result = spawnSync(
    python,
    [join(root, 'scripts', 'voicevox', 'synthesise.py'), voicevoxCache],
    {
      input: requests.map(request => JSON.stringify(request)).join('\n'),
      encoding: 'utf8',
      maxBuffer: 1 << 30,
    },
  )
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`VOICEVOX: ${result.stderr}`)
  return result.stdout
    .trim()
    .split('\n')
    .map((line): { query?: AudioQuery } => JSON.parse(line))
}

const f32 = Math.fround

// Each VOICEVOX line's file: VOICEVOX's query for its kana, its mora
// pitches set from the accent between the voice's pinned levels, with
// 0.3 s of silence before and after, at VOICEVOX's own speed.
const synthesise = (
  lines: ReadonlyArray<StarterListLine>,
): ReadonlyMap<string, Uint8Array> => {
  const made = new Map<string, Uint8Array>()
  if (lines.length === 0) return made
  const voiced = lines.map(line => {
    if (line.recording.kind !== 'Voicevox')
      throw new Error(`${line.id} is not VOICEVOX`)
    return { line, voice: voiceOf(line.recording.voice) }
  })
  const queries = voicevox(
    voiced.map(({ line, voice }) => ({
      query: voicevoxKana(line.words),
      style: voice.styleId,
      model: voice.model,
    })),
  )
  const scratch = mkdtempSync(join(tmpdir(), 'starter-pack-'))
  try {
    const jobs = voiced.map(({ line, voice }, k) => {
      const query = queries[k]?.query
      if (query === undefined)
        throw new Error(`VOICEVOX gave no query for ${line.id}`)
      return {
        line,
        voice,
        out: join(scratch, `${line.id}.wav`),
        query: {
          ...accentPitches(query, voice.levels),
          speed_scale: f32(1),
          pre_phoneme_length: f32(leadSeconds),
          post_phoneme_length: f32(tailSeconds),
        },
      }
    })
    voicevox(
      jobs.map(({ voice, query, out }) => ({
        synthesise: query,
        style: voice.styleId,
        model: voice.model,
        out,
      })),
    )
    for (const { line, out } of jobs) {
      const wav = decodeWav(readFileSync(out))
      if (wav.sampleRate !== packSampleRate)
        throw new Error(`${line.id}: ${wav.sampleRate} Hz`)
      made.set(line.id, packWav(toMono(wav.channels)))
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
  return made
}

// What the pack on disk says each line's file was made from.
const readFiles = (): StarterPackFiles | undefined =>
  existsSync(filesPath)
    ? Schema.decodeUnknownSync(StarterPackFiles)(
        JSON.parse(readFileSync(filesPath, 'utf8')),
      )
    : undefined

// Every file the pack should hold, as bytes: a line's file kept from the
// pack when it was made from the same thing and is unchanged, else made.
const packFiles = async (
  list: StarterList,
  remake: boolean,
  offline: boolean,
): Promise<ReadonlyMap<string, Uint8Array>> => {
  const before = new Map(
    (readFiles()?.lines ?? []).map(line => [line.id, line]),
  )
  const files = new Map<string, Uint8Array>()
  const toSynthesise: Array<StarterListLine> = []
  for (const line of list.lines) {
    if (line.review.verdict === 'reject') continue
    const path = audioPathOf(line)
    const kept = before.get(line.id)
    const onDisk = join(packDir, path)
    if (
      !remake &&
      kept !== undefined &&
      kept.made === recipeOf(line) &&
      existsSync(onDisk)
    ) {
      const bytes = readFileSync(onDisk)
      if (sha256Of(bytes) === kept.sha256) {
        files.set(path, bytes)
        continue
      }
    }
    const recording = line.recording
    if (recording.kind === 'Voicevox') {
      toSynthesise.push(line)
    } else if (recording.kind === 'Commons') {
      files.set(
        path,
        convertRecording(await cachedDownload(recording, offline)),
      )
    } else {
      files.set(
        path,
        convertRecording(
          await cachedDownload(recording, offline),
          recording.from,
          recording.to,
        ),
      )
    }
  }
  if (toSynthesise.length > 0) {
    if (offline && !existsSync(python)) {
      throw new Error(
        `Not current: ${toSynthesise.map(line => line.id).join(', ')} must be synthesised again, which needs VOICEVOX CORE.`,
      )
    }
    for (const [id, bytes] of synthesise(toSynthesise)) {
      files.set(audioPathOf({ id }), bytes)
    }
  }
  return files
}

const secondsOf = (bytes: Uint8Array): number => {
  const wav = decodeWav(bytes)
  return (wav.channels[0]?.length ?? 0) / wav.sampleRate
}

const buildPack = async (remake: boolean, check: boolean): Promise<void> => {
  const list = readList()
  const problems = listProblems(list)
  if (problems.length > 0) {
    throw new Error(`starter/lines.json:\n${problems.join('\n')}`)
  }
  const files = await packFiles(list, remake, check)
  const audioOf = (line: StarterListLine) => {
    const bytes = files.get(audioPathOf(line))
    if (bytes === undefined) throw new Error(`no file for ${line.id}`)
    return { seconds: secondsOf(bytes), sha256: sha256Of(bytes) }
  }
  const pack = packOf(list, audioOf)
  const wanted = new Map<string, Uint8Array | string>([
    [levelsPath, json(Schema.encodeSync(StarterPack)(pack))],
    [
      filesPath,
      json(Schema.encodeSync(StarterPackFiles)(packFilesOf(list, audioOf))),
    ],
    [creditsPath, creditsMarkdown(pack)],
    ...[...files].map(([path, bytes]) => [join(packDir, path), bytes] as const),
  ])
  const audioDir = join(packDir, 'audio')
  const stale = existsSync(audioDir)
    ? readdirSync(audioDir)
        .map(name => join(audioDir, name))
        .filter(path => !wanted.has(path))
    : []
  if (check) {
    const differ = [...wanted]
      .filter(([path, content]) => {
        if (!existsSync(path)) return true
        const now = readFileSync(path)
        const next =
          typeof content === 'string' ? Buffer.from(content) : content
        return !now.equals(next)
      })
      .map(([path]) => path)
    const named = [...differ, ...stale].map(path => path.slice(base.length + 1))
    if (named.length > 0) {
      throw new Error(
        `The starter pack is not current; run \`npm run starter:pack\`:\n${named.join('\n')}`,
      )
    }
    console.log(`The starter pack is current: ${files.size} lines.`)
    return
  }
  for (const path of stale) rmSync(path)
  for (const [path, content] of wanted) writeFile(path, content)
  console.log(`Wrote the starter pack: ${files.size} lines.`)
}

// A file already in .cache/starter/ with Commons' SHA-1 for it, so a
// second run downloads nothing it has.
const cachedBySha1 = (name: string, sha1: string): Uint8Array | undefined => {
  if (!existsSync(sourcesCache)) return undefined
  for (const dir of readdirSync(sourcesCache)) {
    const path = join(sourcesCache, dir, name)
    if (!existsSync(path)) continue
    const bytes = readFileSync(path)
    if (createHash('sha1').update(bytes).digest('hex') === sha1) return bytes
  }
  return undefined
}

type RawRecording = { kind?: string; file?: string; [key: string]: unknown }
type RawLine = { id: string; recording: RawRecording; [key: string]: unknown }

const commonsPage = (title: string): string =>
  `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replaceAll(' ', '_')).replaceAll('%3A', ':')}`

const plainText = (html: string): string =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .trim()

// Lingua Libre names its speaker and its recorder; one person is both.
const authorOf = (artist: string): string => {
  const speaker = /Speaker:\s*(.+)/.exec(artist)?.[1]?.trim()
  const recorder = /Recorder:\s*(.+)/.exec(artist)?.[1]?.trim()
  if (
    speaker !== undefined &&
    (recorder === undefined || recorder === speaker)
  ) {
    return speaker
  }
  if (speaker !== undefined) return `${speaker}, recorded by ${recorder}`
  return artist.replace(/\s+/g, ' ')
}

// Reads each Commons file's metadata, then downloads it to pin it.
const refreshCommons = async (): Promise<void> => {
  const raw: { lines: Array<RawLine> } = JSON.parse(
    readFileSync(listPath, 'utf8'),
  )
  const commons = raw.lines.filter(line => line.recording.kind === 'Commons')
  for (let k = 0; k < commons.length; k += 50) {
    const batch = commons.slice(k, k + 50)
    const url = new URL('https://commons.wikimedia.org/w/api.php')
    url.search = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      prop: 'imageinfo',
      iiprop: 'url|size|sha1|extmetadata',
      iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist',
      titles: batch.map(line => String(line.recording.file)).join('|'),
    }).toString()
    const answer: {
      query: {
        normalized?: Array<{ from: string; to: string }>
        pages: Array<{
          title: string
          missing?: boolean
          imageinfo?: Array<{
            url: string
            size: number
            sha1: string
            extmetadata: Record<string, { value: string } | undefined>
          }>
        }>
      }
    } = JSON.parse(await fetchJsonText(url))
    for (const line of batch) {
      const title = String(line.recording.file)
      const normal =
        answer.query.normalized?.find(entry => entry.from === title)?.to ??
        title
      const page = answer.query.pages.find(found => found.title === normal)
      const info = page?.imageinfo?.[0]
      if (info === undefined)
        throw new Error(`${line.id}: no file ${title} on Commons`)
      const meta = info.extmetadata
      // The file's own address, without the tracking query Commons adds.
      const fileUrl = info.url.split('?')[0] ?? info.url
      const bytes =
        cachedBySha1(decodeURIComponent(basename(fileUrl)), info.sha1) ??
        (await fetchBytes(fileUrl))
      if (bytes.length !== info.size)
        throw new Error(
          `${line.id}: ${bytes.length} B, Commons says ${info.size}`,
        )
      const sha256 = sha256Of(bytes)
      writeFile(
        join(sourcesCache, sha256, decodeURIComponent(basename(fileUrl))),
        bytes,
      )
      console.log(`${line.id}: ${normal}, ${bytes.length} B`)
      line.recording = {
        kind: 'Commons',
        file: normal,
        page: commonsPage(normal),
        url: fileUrl,
        bytes: bytes.length,
        sha256,
        author: authorOf(plainText(meta['Artist']?.value ?? '')),
        licence: plainText(meta['LicenseShortName']?.value ?? ''),
        // Commons gives CC0's address as http://; the same page is served
        // over https.
        licenceUrl: plainText(meta['LicenseUrl']?.value ?? '').replace(
          /^http:\/\/creativecommons\.org\//,
          'https://creativecommons.org/',
        ),
      }
      await sleep(2000)
    }
  }
  // Refused here, before anything is written, if a licence is not one
  // the set allows.
  const list = Schema.decodeUnknownSync(StarterList)(raw)
  writeFile(listPath, json(Schema.encodeSync(StarterList)(list)))
  console.log(`Pinned ${commons.length} Commons files.`)
}

const unidicDictionary = async (): Promise<Uint8Array> => {
  const dictionaryPath = join(unidicCache, unidic.dictionary)
  if (existsSync(dictionaryPath)) {
    const bytes = readFileSync(dictionaryPath)
    if (sha256Of(bytes) === unidic.dictionarySha256) return bytes
  }
  const zipPath = join(unidicCache, basename(unidic.url))
  const zip =
    existsSync(zipPath) && sha256Of(readFileSync(zipPath)) === unidic.sha256
      ? readFileSync(zipPath)
      : await fetchBytes(unidic.url)
  if (zip.length !== unidic.bytes || sha256Of(zip) !== unidic.sha256) {
    throw new Error(`${unidic.url}: not the pinned file`)
  }
  writeFile(zipPath, zip)
  const bytes = unzipSync(zip, {
    filter: file => file.name === unidic.dictionary,
  })[unidic.dictionary]
  if (bytes === undefined || sha256Of(bytes) !== unidic.dictionarySha256) {
    throw new Error(
      `${unidic.url}: its ${unidic.dictionary} is not the pinned one`,
    )
  }
  writeFile(dictionaryPath, bytes)
  return bytes
}

// Each word's page on the English Wiktionary, as wikitext.
const wiktionaryPages = async (
  titles: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, string>> => {
  const pages = new Map<string, string>()
  const unique = [...new Set(titles)]
  for (let k = 0; k < unique.length; k += 50) {
    const url = new URL('https://en.wiktionary.org/w/api.php')
    url.search = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      prop: 'revisions',
      rvprop: 'content',
      rvslots: 'main',
      titles: unique.slice(k, k + 50).join('|'),
    }).toString()
    const answer: {
      query: {
        normalized?: Array<{ from: string; to: string }>
        pages: Array<{
          title: string
          revisions?: Array<{ slots: { main: { content: string } } }>
        }>
      }
    } = JSON.parse(await fetchJsonText(url))
    for (const title of unique.slice(k, k + 50)) {
      const normal =
        answer.query.normalized?.find(entry => entry.from === title)?.to ??
        title
      const page = answer.query.pages.find(found => found.title === normal)
      pages.set(title, page?.revisions?.[0]?.slots.main.content ?? '')
    }
    await sleep(500)
  }
  return pages
}

const refreshAccents = async (): Promise<void> => {
  const list = readList()
  const features = unidicFeatures(await unidicDictionary())
  const checked = list.lines.flatMap(line =>
    line.words.filter(word => word.byRule === undefined),
  )
  const pages = await wiktionaryPages(checked.map(word => word.text))
  const lines = list.lines.map((line): StarterListLine => {
    const words = line.words.map(word =>
      word.byRule !== undefined
        ? word
        : {
            ...word,
            unidic: unidicAccents(features, word.text, word.kana),
            wiktionary: wiktionaryAccents(
              pages.get(word.text) ?? '',
              word.kana,
            ),
          },
    )
    const { flag: _, ...rest } = { ...line, words }
    const flag = lineFlag(rest)
    return flag === undefined ? rest : { ...rest, flag }
  })
  writeFile(listPath, json(Schema.encodeSync(StarterList)({ ...list, lines })))
  const flagged = lines.filter(line => line.flag !== undefined)
  console.log(
    `Checked ${checked.length} words; ${flagged.length} lines flagged:\n${flagged.map(line => `${line.id}: ${line.flag}`).join('\n')}`,
  )
}

const applyExport = async (file: string): Promise<void> => {
  const review = Schema.decodeUnknownSync(ReviewExport)(
    JSON.parse(readFileSync(file, 'utf8')),
  )
  const list = applyReview(readList(), review)
  writeFile(listPath, json(Schema.encodeSync(StarterList)(list)))
  console.log(
    `Applied ${review.verdicts.length} verdicts of ${review.reviewedOn}.`,
  )
  await buildPack(false, false)
}

try {
  if (values.commons) await refreshCommons()
  else if (values.accents) await refreshAccents()
  else if (values.apply !== undefined) await applyExport(values.apply)
  else await buildPack(values.remake, values.check)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
