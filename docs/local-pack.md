# The local pack

The local pack is Daniel's own recordings, kept in the git-ignored `local/` folder of the working copy with a small manifest, `pack.json`, and imported in the browser as one level.
It is where recordings that may be practised but not published go: JSUT sentences (personal use, as JSUT's terms allow; report section 8), and public recordings that are not openly licensed.
`AGENTS.md`, "The local pack", says where the code is.

## It stays on the device

- The pack is never committed: `local/` is in `.gitignore`.
- The pack is never built or hosted: a build fails when anything from `local/` reaches its output (below).
- The pack is imported from files Daniel chooses in the browser, and kept on that device like an upload: its files in the origin private file system, its lines and their curves in IndexedDB.
  Nothing of it is sent anywhere.
- A line's source link is only shown, as a link that opens in a new tab with `rel="noopener noreferrer"`.
  The app never fetches it, and downloads nothing from YouTube or any other site: a YouTube line is a link and times to find it again (report section 6, "Why YouTube can only be links in the local pack"), and its audio in the pack is whatever copy Daniel chose to keep, outside the app.
- A backup carries the pack like any clip: its lines always, its files only when the recordings are asked for.
  The backup is a file on Daniel's own device.

## The manifest

`pack.json` sits at the top of the pack's folder, and names each line's file by its path from there.
Its Schema is `PackManifest` in `src/services/local-pack.ts`; a manifest it does not decode is refused whole, saying what and where.

```json
{
  "version": 1,
  "id": "jsut-basic",
  "name": "JSUT, the first sentences",
  "lines": [
    {
      "file": "wav/BASIC5000_0001.wav",
      "text": "水をマレーシアから買わなくてはならないのです。",
      "kana": "みずをまれーしあからかわなくてはならないのです"
    },
    {
      "file": "clips/interview.m4a",
      "start": 63.2,
      "end": 66.8,
      "text": "今日は駅で古い友達に会いました",
      "source": {
        "url": "https://www.youtube.com/watch?v=...",
        "start": 1243.5,
        "end": 1247.1
      }
    }
  ]
}
```

| Field                  | Required | What it is                                                                                                                         |
| ---------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `version`              | yes      | The manifest's format: 1.                                                                                                          |
| `id`                   | yes      | Up to 63 lower-case letters, digits and dashes. Importing a manifest with the same id again updates its level, `/level/pack-<id>`. |
| `name`                 | yes      | The level's name.                                                                                                                  |
| `lines`                | yes      | One or more lines, in the order the level lists them.                                                                              |
| `lines[].file`         | yes      | The line's audio file, by its path from the folder `pack.json` is in, with `/` between folders and no `..`.                        |
| `lines[].start`, `end` | no       | Seconds from the file's start; the start is 0 and the end the file's end when not given.                                           |
| `lines[].text`         | no       | The line as written, its title; a line with none is called by its place, "Line 3".                                                 |
| `lines[].kana`         | no       | Its reading, shown under its text.                                                                                                 |
| `lines[].source`       | no       | Where it came from: `url`, a web address starting `https://` or `http://`, and `start` and `end`, seconds in it, both optional.    |

A line is a quarter of a second to 20 s long, since a take records at most 30 s; a file can be at most ten minutes long, as an upload can, and any format the browser decodes (`docs/uploads.md`).
A line that runs past the end of its file is refused, naming the file.

## Importing it

On `/upload`, under "Import your local pack", Daniel chooses the pack's folder (where the browser lets a page choose one: the button shows only then, and `tests/e2e/local-pack.spec.ts` proves it in Chromium), or chooses or drops `pack.json` with its audio files together.
Files chosen one by one have no path, so each is found by its name; when two files of the pack share a name in different folders, the folder must be chosen.
The `pack.json` nearest the top of what was chosen is the manifest.

The import checks the manifest whole and finds every file it names before reading any: when one is missing, it names each missing file and keeps nothing.
It then reads each file's SHA-256, tracks each new line with the cut's own tracking in the clip Worker, one Worker for all the files, and keeps the level.
Stop ends it before it starts keeping, and keeps nothing.

## Importing it again

Change `pack.json`, or a file, and import the pack again: its level is updated in place.

- A line whose file is the same, by its SHA-256, and whose start and end are the same keeps its id, its curve and so every take of it; its text, kana and source are taken from the manifest as it is now.
- Every other line is new, with an id never used before in the level, and is tracked.
- A line the manifest no longer has leaves the level; its takes stay in the history under its old name, and keep the curve they were scored against.
- A file no line names any more, or a changed file's old copy, is deleted from the device.

So a pack's lines are changed only by its manifest: its level has no line editor.

## The build check

`build/local-pack-guard.ts` fails a production build, naming what came from the pack, when the build holds a module imported from `local/`, an asset emitted from it (an audio file imported with `?url`, say), or any output file, the public folder's copies included, whose bytes are those of a file in `local/`, under any name.
`tests/build/local-pack-guard.test.ts` proves it with real builds against a planted pack: a planted import, a planted audio import, and planted copies in the public folder, renamed and linked.

## The example pack

`fixtures/local-pack/` is a small example pack for the tests, never `local/`: two VOICEVOX phrases, each a whole file with its text, one with its kana and a planted YouTube link, and the first 8 s of a LibriVox CC0 reading with two lines and no text, one linking its source.
`npm run fixtures:local-pack` writes it from the fixtures beside it, and `tests/scripts/local-pack-fixture.test.ts` remakes it byte for byte.
`tests/e2e/local-pack.spec.ts` imports it in the built app, by its files and by its folder, practises a line with the fake microphone, imports it again with a changed manifest and sees the unchanged line keep its take, refuses a selection missing a file, and sees no request to a link's host or anywhere off the app's origin.
