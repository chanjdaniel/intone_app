# The bundle budget

`bundle-budget.json` caps the gzip size of what the page loads before it starts: the entry chunk, the module script the built `index.html` loads, and every chunk it imports statically, directly or through each other.
CI builds the app and runs `npm run check:budget`, which fails above the cap, naming the chunks and by how much.
The script, `build/bundle-budget.ts`, gzips each chunk on its own at level 9, as a host sends them, and adds the bytes; its reader is the one the tests use.

The bundler moves modules the entry shares with lazily loaded chunks into a chunk of their own when two or more lazy chunks share them, and the entry imports that chunk statically: measuring the entry chunk alone would then count less than the page loads.
Ticket 12 of T242 met this (a second lazy chunk moved 47 kB of Effect out of the entry), and the reader has counted the static imports since.

## Every other chunk

Every chunk the page does not load at start has a line of its own in `bundle-budget.json`, by its name without Vite's content hash: each Worker, the capture worklet, each chunk the app loads lazily, the WebAssembly the bundler emits under `assets/` beside a package's module (Lindera's), and ONNX Runtime's WebAssembly and its loader under `ort/<version>/`.
The check fails on a chunk over its line, on a chunk the build makes that has no line, and on a line naming a chunk the build no longer makes, so a new Worker or lazy chunk comes with its line.
No model file is in any of them: models are served whole from `/models/` (`docs/deploying.md`).

Each line is the chunk's gzip size, measured through Vite's production build, plus 10%, rounded up to the next 1,000 B:

| Chunk                                                                           | Gzip        | Line        |
| ------------------------------------------------------------------------------- | ----------- | ----------- |
| `tracker.worker` (SwiftF0 and ONNX Runtime's JavaScript)                        | 50,823 B    | 56,000 B    |
| `clip.worker` (Silero VAD, SwiftF0, the cut)                                    | 52,657 B    | 58,000 B    |
| `clip-store.worker` (the origin private file system)                            | 25,449 B    | 28,000 B    |
| `capture-processor` (the worklet)                                               | 336 B       | 1,000 B     |
| `backup` (the backup's code and `fflate`)                                       | 7,694 B     | 9,000 B     |
| `compare-take` (the score's maths)                                              | 3,223 B     | 4,000 B     |
| `ort-wasm-simd-threaded.mjs`                                                    | 9,216 B     | 11,000 B    |
| `ort-wasm-simd-threaded.wasm`                                                   | 3,827,372 B | 4,180,000 B |
| `text.worker` (Transformers.js, its ONNX Runtime's JavaScript, the text Worker) | 174,641 B   | 193,000 B   |
| `ort-wasm-simd-threaded.asyncify.mjs` (Transformers.js's ONNX Runtime)          | 19,394 B    | 22,000 B    |
| `ort-wasm-simd-threaded.asyncify.wasm` (Transformers.js's ONNX Runtime)         | 6,625,019 B | 7,288,000 B |
| `readings.worker` (the readings Worker, Lindera's module and `fflate`'s unzip)  | 40,321 B    | 45,000 B    |
| `lindera_wasm_bg` (Lindera's WebAssembly)                                       | 707,439 B   | 779,000 B   |

ONNX Runtime's files are its release's own and change only when it is upgraded (`docs/upgrading.md`); Transformers.js's two come with its own pinned ONNX Runtime, so they move only when Transformers.js does.
The text Worker's chunk and Transformers.js's ONNX Runtime are fetched only once the learner agrees to the text model's download (`docs/transcription.md`).
The readings Worker's chunk and Lindera's WebAssembly are fetched only once the learner shows a line's readings (`docs/readings.md`).

## How the cap was set

The cap is the entry chunk's size, measured through Vite's production build in a clean tree, rounded up to the next 10 kB (10,000 bytes), plus 20 kB.

| Measured at                    | Entry chunk, gzip | Cap       |
| ------------------------------ | ----------------- | --------- |
| `1e21a2b5` (ticket 03 of T242) | 100,804 B         | 130,000 B |
| ticket 12 of T242              | 153,950 B         | 180,000 B |
| ticket 15 of T242              | 186,599 B         | 210,000 B |
| ticket 17 of T242              | 211,041 B         | 240,000 B |

The base it was measured against, `3997c12d`, built the same way, gives 98,217 B: ticket 03 added 2,587 B with its routes, its not-found screen and the bridge to the dev library, whose own modules stay out of the build.

Ticket 12 raised it, measured against its base `3a2b07ed` built the same way: 126,715 B to 153,950 B, 27,235 B more, all in the entry chunk (it imports no chunk statically).
The history and settings screens, which a single Foldkit program cannot load lazily, carry the growth; by the minified bytes each module adds, from the build's source map:

| What grew                                                              | Minified |
| ---------------------------------------------------------------------- | -------- |
| `src/app/history/` (calendar, list, trend, both screens, their update) | 26,378 B |
| `src/app/settings/` (the screen, its Commands and update)              | 19,808 B |
| `src/services/` (the history store, its records, the clip store)       | 15,369 B |
| `@foldkit/ui`'s Dialog, for the clear-all confirmation                 | 13,770 B |
| Effect (Schema checks and transforms, `Random`)                        | 7,814 B  |
| Foldkit (`Calendar`, `File`, the dialog's DOM helpers)                 | 7,503 B  |
| The rest of `src/app` (routes, Messages, the practice screen's note)   | 3,552 B  |

The backup's code and `fflate` stay out of it, in a chunk loaded only when a backup is saved or restored (7.5 kB gzip).
Loading the history store lazily too was tried and saved nothing: a second lazy chunk made the bundler split Effect out of the entry, and the two chunks the page then loads came to 1.1 kB more.

Ticket 15 raised it again, measured against its base `dd322800` built the same way: 179,015 B to 186,599 B, 7,584 B more, all in the entry chunk (it imports no chunk statically).
Tickets 13 and 14 had added their screens under the cap ticket 12 set; ticket 15's local pack import took it over.
By the minified bytes each part adds, from the build's source map:

| What grew                                                                                       | Minified |
| ----------------------------------------------------------------------------------------------- | -------- |
| `src/services/local-pack.ts` (the manifest's Schema, finding the files, the plan, the import)   | 10,794 B |
| `src/app/upload/` (the pack's panel, its update, Subscription and Model)                        | 9,609 B  |
| `src/app/line/` (the source link, a pack line's title and detail)                               | 1,922 B  |
| `src/services/history-clips.ts` (`replaceClip`)                                                 | 1,574 B  |
| `src/app/level/` (a pack line's text, kana and link in its row, its delete wording)             | 1,864 B  |
| `src/services/history-records.ts` (the pack's records and the helpers that read a clip's audio) | 1,416 B  |
| `src/app/main.ts`, `src/app/message.ts` (the Messages)                                          | 946 B    |
| Effect                                                                                          | 702 B    |
| `src/services/clip-analyser.ts` (`tracker`)                                                     | 453 B    |

Loading `src/services/local-pack.ts` lazily was tried, and the page loaded more: its own chunk is 4,002 B gzip, but a second lazy chunk sharing the entry's modules with the backup's made the bundler split 47 kB of Effect and the history's records out of the entry into a chunk it imports statically, and the page then loaded 187,050 B before starting, against 186,689 B with the import in the entry.
The screens' parts cannot be loaded lazily in a single Foldkit program.

Ticket 17 raised it again, measured against its base `1d58abd6` built the same way: 205,038 B to 211,041 B, 6,003 B more, all in the entry chunk (it imports no chunk statically).
Ticket 16 had added its screens under the cap ticket 15 set; ticket 17's readings took it over, by 1,041 B.
By the minified bytes each part adds, from the build's source map:

| What grew                                                                                         | Minified |
| ------------------------------------------------------------------------------------------------- | -------- |
| `src/app/readings/` (the update, the view with its ruby and edit form, Commands, Model, resource) | 14,975 B |
| `src/app/main.ts`, `src/app/message.ts` (the Messages and their handling)                         | 2,720 B  |
| `src/engine/text/readings.ts` (the words over the text, the kana split over the kanji)            | 1,775 B  |
| `src/services/readings.ts`, `src/workers/readings-protocol.ts` (opening the Worker)               | 1,630 B  |
| Effect (Schema)                                                                                   | 611 B    |
| `src/services/history-clips.ts`, `history-records.ts` (a line's kept edits)                       | 565 B    |
| `src/app/credits/creditsView.ts`, `src/app/line/` (the tokeniser's credit, the heading's ruby)    | 810 B    |

Another 513 B the source map gives no module.
The readings' tokeniser and dictionary stay out of it: the Worker's chunk and Lindera's WebAssembly load only when the learner shows readings.
The readings' view, update and Messages cannot be loaded lazily in a single Foldkit program.

A clean tree, so that nothing local (a git-ignored `.env` inlines `VITE_` values) moves the size:

```bash
scratch=$(mktemp -d)
git archive HEAD | tar -x -C "$scratch"
ln -s "$PWD/node_modules" "$scratch/node_modules"
(cd "$scratch" && npx vite build --outDir "$scratch/out")
node build/bundle-budget.ts --dist "$scratch/out"
```

Remove the scratch directory by the path `mktemp` printed when done.

## Raising it

A raise is justified in its pull request by two builds made the same way: the base and the head, each in a clean tree as above.
Give both sizes and the delta, say which chunk grew, and, when it is not obvious, which change grew it, found by swapping one changed file at a time into the base build.
Today the file and the script know only the entry chunk; as the Workers, the worklet, ONNX Runtime and Transformers.js land, each as a lazily loaded chunk of its own, each gets its own line in both.
