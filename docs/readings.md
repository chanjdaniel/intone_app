# Readings

A line's readings are the kana Intone shows over its kanji, so a learner can read a line whose kanji they do not know.
They come from a dictionary run on the device, and the learner can edit any of them.
Readings are for reading: no score reads them, and `src/services/text-and-score.test.ts` holds that an edited reading leaves the line's recording and every score of it as they were.
This file says what the learner sees, which tokeniser was chosen and why, what it reads right and wrong, and how it runs.

## What the learner sees

- On a line's practice screen, under a line with Japanese text, a "Show readings" button.
  Until the learner first shows readings it says what that costs: "Shows the kana over the kanji. The first time, it downloads the reading dictionary, 12 MB, from Intone itself."
  Nothing of the dictionary is fetched before the press.
- Shown, the line's heading carries the kana over each run of kanji as ruby (`<ruby>`, with `<rp>` parentheses for a browser with none), in the app's own font stack, Japanese faces first; the kana a word is written with stay bare, so 好き has す over 好 alone.
  The note under the buttons, a polite live region, says "Loading the readings…" until they come, then "Readings come from a dictionary and may be wrong; edit any that are."
- "Edit a reading" opens a form of one field a word with kanji, labelled by the word, holding its reading, with the dictionary's as the placeholder.
  A reading must be kana (hiragana, katakana or ー); a field left empty, or holding the dictionary's own reading, is no edit.
  An edited reading is drawn in the accent's colour, the dictionary's in grey, and the note counts them ("One reading is your own, in colour.").
- The choice to show readings is kept with the settings, so readings stay shown, or hidden, across a reload and from line to line; "Hide readings" hides them and frees the dictionary.
- `/credits` names the dictionary (from `models.json`, as every model) and Lindera, the tokeniser, each with its licence and source; `NOTICES.md` lists the `lindera-wasm` package and the dictionary's files.

Readings are shown on the practice screen only, where a line is read to be copied; a level's list and the history show the text alone.

## The candidates

The report (T226, section 2, "Readings and morae") named two, `kuromoji`'s maintained fork and `lindera-wasm`, and left their accuracy on Whisper's output unverified.
Measured on 2026-11-13, from npm and GitHub:

| Candidate                                            | Licence                             | Last release    | What the browser downloads                                    | Opens in Node |
| ---------------------------------------------------- | ----------------------------------- | --------------- | ------------------------------------------------------------- | ------------- |
| `kuromoji` 0.1.2                                     | Apache-2.0                          | 2018 (the code) | 17.8 MB of gzipped dictionary files, unpacked by its own zlib | -             |
| `@sglkc/kuromoji` 1.1.0 (the report's fork)          | Apache-2.0                          | 2023-09         | the same 17.8 MB                                              | -             |
| `@patdx/kuromoji` 1.0.4 (a TypeScript fork)          | Apache-2.0                          | 2024-11         | the same 17.8 MB                                              | 407 ms        |
| `lindera-wasm` 6.2.0 with `lindera-ipadic-6.2.0.zip` | MIT; the dictionary IPADIC's notice | 2026-09         | 1.78 MB WebAssembly (712 kB gzip) and a 10.5 MB zip           | 156 ms        |
| `lindera-wasm-ipadic` 2.1.0 (the dictionary inside)  | MIT; IPADIC's notice                | 2026-02         | an 18.0 MB WebAssembly file                                   | -             |
| `lindera-wasm` 6.2.0 with `lindera-unidic-6.2.0.zip` | MIT; UniDic's BSD, LGPL or GPL      | 2026-09         | 1.78 MB WebAssembly and a 46.4 MB zip                         | 402 ms        |

The kuromoji forks and Lindera's IPADIC build carry the same dictionary, mecab-ipadic 2.7.0, so they read the same words the same way: on the three CC0 clips' text and on Whisper base's and small's writing of it, every word with kanji got the same reading from both, and they differed only on words neither knows (kuromoji gives each unknown character alone and no reading; Lindera keeps the run whole and gives `*`).
UniDic, as Lindera ships it, has no kana form of a word as written, only its pronunciation (とーきょー for 東京), which furigana cannot use, and on the CC0 text it read worse (相合傘 as そーごー さん, 眼鏡 as がんきょー, 老大家 as らおたい か), at four times the download.

**The choice: `lindera-wasm` 6.2.0 with Lindera's IPADIC build.**
It reads as well as kuromoji, downloads 12.3 MB against 17.8 MB, opens in less than half the time, is released monthly by a maintained project, and is MIT; the dictionary, which no npm package ships at that version, is in `models.json` as the model `lindera-ipadic`, served from the app's own origin like every model.

## What it reads right and wrong

On the three CC0 clips' text (`fixtures/real/<clip>.txt`), the dictionary finds 121 words with kanji; 112 have the reading their text gives them in context, and 9 do not:

| Clip          | Text     | Dictionary    | In context  |
| ------------- | -------- | ------------- | ----------- |
| `gongitsune`  | 小狐     | しょう きつね | こ ぎつね   |
| `good-bye`    | 二人     | に にん       | ふた り     |
| `good-bye`    | 一ぺん   | いち          | いっ        |
| `good-bye`    | おさめ時 | じ            | どき        |
| `romandourou` | 永い間   | ま            | あいだ      |
| `romandourou` | 筐底     | かたみ そこ   | きょう てい |

Each wrong reading is a word split in two (小狐, 二人, 筐底) or one whose reading turns on the words around it (間, 時, 一); the edit form fixes each, a word at a time, as the end-to-end test does for 小狐.
`tests/readings/lindera.test.ts` runs the readings Worker's own tokeniser on the real dictionary under Node and holds both numbers and the list.

On Whisper's writing of the same clips the readings follow Whisper's kanji: where Whisper heard a wrong word (医療 for 入江) the reading is right for the wrong word, and the words neither dictionary knows (聴史, 設) get no reading, an empty field the learner can fill.
The text's own errors are the transcript's (`docs/transcription.md`); the readings add none of their own there that the reference text did not show.

## How it runs

- `src/workers/readings.worker.ts` fetches the dictionary's zip from `/models/lindera-ipadic/<version>/`, checks its length against `models.json`, and opens the tokeniser in a scope (`src/workers/lindera-session.ts`): Lindera's WebAssembly, which the bundler emits under `/assets/` beside its module, then the dictionary's nine files unzipped with `fflate` and loaded with `loadDictionaryFromBytes`.
  It speaks `src/workers/readings-protocol.ts`: `Load`, `Read`, `Close` in; `Loaded`, `Tokens`, `Failed`, `Closed` out.
  A token's reading is IPADIC's reading field, in katakana, `*` when the word is unknown.
- `src/services/readings.ts` (`Readings`, with `layer` and `layerTest(tokens, error)`) opens the Worker through `openWorkerSession` and turns each text's tokens into words by their place in it (`wordsOf`, `src/engine/text/readings.ts`).
- `src/app/readings/` holds it in the app: `ReadingsResource` (a ManagedResource) holds the Worker while a line with Japanese text is open with readings shown, from one line to the next, and releases it when they are hidden or the practice screen is left; `withReadings`, run after every update, asks for the open line's words once the Worker is loaded, unless the Model has them for that line and text.
  Unpacked, the dictionary takes about 50 MB of the Worker's memory, so it is held only while readings are shown.
- The kana go over each run of kanji by matching the word's reading against the kana it is written with (`rubyParts`); a reading that does not fit around them goes over the whole word.
- The learner's edits are kept with the line: a line of a clip or a local pack on its record (`ClipLine.readings`), a bundled line in the settings (`Settings.bundledReadings`, by line key), since it has no record.
  Each is kept with the text it was made on and applies only while the line's text is that text; a moved line keeps its edits, a split or merged one does not, and a local pack's line imported again unchanged keeps them.
  The backup carries both, as part of the clips and the settings.
- The zip and the WebAssembly are served with `Cache-Control: immutable` under versioned paths (`build/headers.ts`), so the browser's cache keeps them; Lindera publishes the dictionary as a release asset at a tag, which `build/models.ts` takes from GitHub releases at a version tag, the size and SHA-256 pinning its bytes.
- Lindera's module finds its WebAssembly by `new URL(..., import.meta.url)`, which the dev server's dependency pre-bundling would break, so `vite.config.ts` leaves `lindera-wasm` out of it.
