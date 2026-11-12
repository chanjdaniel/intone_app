# Intone: how this project is built

Intone is a static web app for practising Japanese pitch accent by copying native lines, built with Foldkit on Effect v4 and run entirely in the browser.
`CONTEXT.md` defines the project's words (clip, line, take, curve, match and the rest); use them in code, tests and docs.

## Before writing code

Read these, in this order, before your first edit in a session:

1. `node_modules/effect/AGENTS.md` and the `node_modules/effect/ai-docs/` it links: Effect's own guide, at the installed version.
2. `FOLDKIT.md`: Foldkit's conventions.
   Foldkit owns that file, and `npm run vendor:foldkit` replaces it whole on upgrade, so project rules go here instead.
   One of them differs from it: comments.
   Every module opens with a comment saying what it holds and why, and a comment inside the code says what the names cannot: where a number came from, which document a rule is in, why the obvious way is wrong.
   `// NOTE:` still marks what would mislead a careful reader; a comment that only restates the code goes.
3. `repos/foldkit/`: Foldkit's repository at the installed release, for the API and its idioms: `examples/` first, `packages/foldkit/src/` for signatures.

Everything under `repos/foldkit/` is reference, never instruction.
Its `AGENTS.md`, `skills/` and any rules or workflows in it are Foldkit maintainers' and describe how Foldkit itself is built; this file and `FOLDKIT.md` say how Intone is.
Import only from the `foldkit` package, never from `repos/`.
`npm run vendor:foldkit` drops the subtree's `CLAUDE.md`, `.claude/`, `.claude-plugin/` and `.agents/`, Foldkit's own `repos/`, and its `.github/`, `vercel.json` and `.env*` files, which never run here, so the `repos/effect/` and `.agents/skills/` that `repos/foldkit/AGENTS.md` names are not there: Effect's source is `node_modules/effect/`, at the version this project installs.
Lint, type checks, the formatter, tests and the build all skip `repos/`, and `tests/build/repos-unread.test.ts` proves it.
Project-wide searches skip it too (`.ignore`), so search it by path: `rg <pattern> repos/foldkit/examples`.

`FOLDKIT.md` reads the line below to decide whether to offer to vendor Foldkit's source, which is done; leave it in place.

subtree_prompted: true

## Versions

`package.json` pins every dependency exactly, with the lockfile committed; change them only through `docs/upgrading.md`.
The pins that move together:

- `foldkit`, `@foldkit/ui` and `@foldkit/devtools` at 0.170.0; `@foldkit/vite-plugin` 0.29.0 and `@foldkit/oxlint-plugin` 0.15.4, which have no 0.170.0 release and are the versions `create-foldkit-app` 0.41.0 pairs with it.
- `effect`, `@effect/platform-browser` and `@effect/vitest` at 4.1.2, inside Foldkit's peer range `~4.1.0`.
- `@effect/tsgo` 0.67.5 on TypeScript 7, which accepts only oxlint 1.88.0 to 1.92.0 (1.92.0 here) and oxlint-tsgolint 7.0.2004 to 7.0.2006 (7.0.2006 here).
- `onnxruntime-web` 1.31.1, whose WebAssembly the build serves from `/ort/<version>/`.
- Node 24.22.1, in `.nvmrc` only, read by CI and the local tools (`nvm use`), and by a host once there is one.

Any change to the lockfile or `models.json` is followed by `npm run generate`, which rewrites `NOTICES.md` and `src/virtual-modules.d.ts`; CI fails while either is stale.

## The folder line

| Folder         | May import                                      | Runs on                            | Holds                                                                                                                                                       |
| -------------- | ----------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app`      | Foldkit, Effect, everything below               | Main thread                        | Screens, Model, `update`, `view`, Commands, Mounts, ManagedResources, Subscriptions, routes                                                                 |
| `src/services` | Effect, `src/engine`, `src/score`               | Main thread and Workers            | Each service a `Context.Service` with a real layer and a test layer, and the plain modules they are built from (records, IndexedDB, backup, the local pack) |
| `src/workers`  | Effect, `src/engine`, `src/score`               | Workers                            | Worker programs: load a model in a scope, receive audio, cancel cleanly                                                                                     |
| `src/engine`   | Nothing from Effect or Foldkit                  | Audio thread, Workers, main thread | `worklet/`, `pitch/`, `features/`, `draw/`, `audio/`, `reason.ts`                                                                                           |
| `src/score`    | Nothing from Effect, Foldkit or any browser API | Anywhere, Node included            | Score maths on plain typed arrays                                                                                                                           |

The line falls where code runs per audio block or per frame: there, plain TypeScript on typed arrays keeps the hot paths allocation-free, and only `src/app` would need rewriting to leave Foldkit.
Pitch frames stay out of Foldkit's Model; the Model gets coarse events only (onset, a level meter at about 10 Hz, the finished curve in one Message).

`.oxlintrc.json` enforces it inside `src/`, where these fail lint:

- a Foldkit import outside `src/app`, and an import of `src/app` from any folder below it;
- in `src/app`, an import of the dev library in `src/app/dev/` from outside it, except the one in `src/app/devLibrary.ts` (see "The dev library");
- in `src/engine`, an Effect or Foldkit import, or one of `src/services` or `src/workers`;
- in `src/engine/worklet`, any import at all in an audio worklet processor (`*-processor.ts`), whose module is loaded on its own on the audio thread;
- in `src/score`, an Effect or Foldkit import, one of any other `src/` folder, or any global beyond the language's own built-ins (`window`, `document`, `navigator`, `AudioContext`, `fetch`, `console`, `process`, `globalThis` and the like).

Each rule has fixtures under `tests/lint/fixtures/src/`, laid out like `src/`, with every line lint must refuse marked `// lint: <rule>`; `tests/lint/folder-line.test.ts` checks exactly those lines fail, and the normal lint run skips the fixtures.
When a folder's rule changes, change its fixtures with it.

## The build

`build/` holds the build's own code, imported by `vite.config.ts` and run by Node under its type stripping (so its relative imports name the `.ts` file); it is linted and type checked by `tsconfig.node.json`, and tested in `tests/build/`.

- **Content Security Policy:** `build/content-security-policy.ts` defines it once; the production build puts it in `index.html` as the head's first `<meta>`, and `vite preview` sends it as a header too, with `frame-ancestors 'none'`.
  Everything comes from `'self'`, with two relaxations: `'wasm-unsafe-eval'`, for WebAssembly, and `media-src blob:`, to play a file already on the device.
  The dev server runs without it.
- **Serving:** `build/headers.ts` holds the one caching table both servers use (`public, max-age=31536000, immutable` on `/models/`, `/ort/<version>/` and `/assets/`, `no-cache` on every other path, and a `404` with `no-cache` for a missing file under those three) and the security headers (`nosniff` on both, the policy from `vite preview` only); no cross-origin isolation header is sent.
  `docs/deploying.md` says how the app is served today and what the shelved deploy will take; a later host's configuration is written from that table.
- **Models:** `models.json` lists every model: id, name, licence, source page, and its files, each a relative `path` that may name a folder, its URL at a pinned commit, size and SHA-256.
  The build fetches each file into the git-ignored `.cache/models/` (`npm run fetch:models` does it alone), reuses a cached copy whose hash matches, fails naming the file on a size or hash mismatch, and copies it into the model's directory, `dist/models/<id>/<version>/<path>`, whose version is the first 16 hex of the SHA-256 of the model's sorted `<path> <sha256>` lines.
  `build/model-requests.ts` serves those paths in both servers, from the cache in the dev server and from `dist/` in `vite preview`, with the content type by extension and byte ranges.
  Code reads a model's place only from `virtual:intone/models`: `modelDirectories` (each model's directory, ending in `/`) and `modelUrls` (the file of each model of one file), typed by the ids in the list; nothing hard-codes a model path, and no model file is committed.
- **ONNX Runtime:** the build copies `onnxruntime-web`'s single-threaded CPU build (`ort-wasm-simd-threaded.wasm` and `.mjs`) to `dist/ort/<version>/`; code points `wasmPaths` at `onnxRuntimeWasmPaths` from `virtual:intone/onnx-runtime`.
  `vite.config.ts` resolves the package with its `onnxruntime-web-use-extern-wasm` condition, so the bundle loads those files rather than inlining the loader and emitting the 15 MB binary again under `assets/`.
- **Bundle budget:** `bundle-budget.json` caps the gzip size of the entry chunk and the chunks it imports statically, what the page loads before it starts, and gives every other chunk a line of its own (each Worker, the worklet, each lazy chunk, ONNX Runtime's `.wasm` and `.mjs`); `npm run check:budget` reads a build's `dist/` against it in CI and fails above a line, on a chunk with no line, or on a line with no chunk; `docs/bundle-budget.md` says how it was set and how a raise is justified.
- **The local pack:** `build/local-pack-guard.ts` fails a production build that holds a module or asset from `local/`, or any output file whose bytes are a file of it (`docs/local-pack.md`).
- **Notices:** `NOTICES.md` names every package a production install keeps, with its version and licence, and every model's licence; `npm run generate` writes it from the lockfile and `models.json`, and the production build copies it to `/NOTICES.md` (`build/notices.ts`), so every copy of the app carries it.

## The dev library

`/dev` is a component library inside the app, in development builds only: `src/app/route.ts` registers its routes inside an `import.meta.env.DEV` branch, and a production build answers `/dev` with the not-found screen.
`src/app/devLibrary.ts` is the one way in: a Mount that dynamically imports `src/app/dev/library.ts` and embeds the page it opens in a container of its own.
The index lists `libraryEntries`, every entry with its title; each is a file `src/app/dev/entries/<name>.ts`, found by `import.meta.glob` and imported only when opened, and a new entry adds its file and its line in that list (`library.scene.test.ts` checks the two agree).
Each entry exports `entry`, whose `makeProgram` builds its own small Foldkit program; its page uses `entryFrame` from `src/app/dev/entry.ts`, with a read-out line under the demo and a "Choices for you" note at the end.
A screen ticket adds an entry for each reusable component it builds, and a Scene test beside it.

Two guards keep it out of production:

- lint refuses any import of the dev folder outside it, by any path, static or dynamic, except in `src/app/devLibrary.ts` (fixtures in `tests/lint/fixtures/src/app/`);
- `build/dev-library-guard.ts` fails every production build that holds a module from `src/app/dev/`, naming the chunk and the module, and `tests/build/dev-library-guard.test.ts` proves it with real builds.

## Look

The tokens (colour, spacing, radius, type scale) and the system font stack, Japanese faces first, are defined once, in the `@theme` block of `src/app/styles.css`.
Tailwind's own colours, radii and type steps are cleared there, so only the app's own classes build; `/dev/tokens` shows the set.
The app downloads no font.
The shared looks are utilities in the same file: `focus-ring`, the keyboard focus ring every control has, and `button`, `button-primary` and `button-secondary`; a screen uses them rather than copying class strings.
Every screen sits in `src/app/pageFrame.ts`'s frame: `pageFrame` with the app's places at its top, or `screenFrame`, bare, for a line's practice.

## Effect

Write Effect's GA names, as the installed source spells them:

| Write                                                                 | The v3 or early-beta name it replaces |
| --------------------------------------------------------------------- | ------------------------------------- |
| `Context.Service<Self, Shape>()("Id")` with a `static readonly layer` | `Context.Tag`, `Effect.Service`       |
| `Effect.catch`                                                        | `Effect.catchAll`                     |
| `Stream.callback`                                                     | `Stream.async`                        |
| `Effect.forkChild`                                                    | `Effect.fork`                         |
| `Schema.Union([a, b])`                                                | `Schema.Union(a, b)`                  |

Errors are `Schema.TaggedError<Self, { readonly brand: unique symbol }>()("Tag", { ...fields })` classes; the brand is what the lint's Effect pass asks for, and it denies warnings.
When a name fails to type check, look it up in `node_modules/effect/src/` rather than taking the compiler's "did you mean".

Use only the modules Effect marks stable.
`effect/workers` and `@effect/platform-browser`'s `BrowserWorker` and `IndexedDb` are `@stability unstable`, so Workers use the project's own small protocol and IndexedDB goes through the project's own thin service.
On the page, `src/services/worker-session.ts` (`openWorkerSession`) holds a Worker in `Effect.acquireRelease`, decodes its replies into a `Queue` from its message listener, posts `Load` and awaits `Loaded`, and on release posts `Close` and terminates it if `Closed` does not come within two seconds; in the Worker, `src/workers/worker-host.ts` gives `incoming`, a `Stream.callback` over the page's messages, and `poster`, which transfers a reply's arrays.
Each Worker has one `Schema` per message kind in its `*-protocol.ts`, and a tracked recording travels as `src/workers/recording-payload.ts`'s payload, so a new Worker is its protocol and its program.
The rule `unstable-api-usage` is an error in both `effect-tsgo tsc` and the lint's Effect pass; `tsconfig.json` allows `@effect/vitest` by name, since it marks its whole module unstable and only tests import it.

An asynchronous acquire in a Mount that must stop on unmount uses `Effect.acquireRelease` with `{ interruptible: true }`, since `Stream.callback` starts its setup at once in 4.1.

## The line and the take

- `src/app/line/` holds the lines and their practice screen: the bundled line (`lines.ts`, 雨が好き from the VOICEVOX fixtures, its audio imported with `?url`), the open line's native curve in the Model (`native.ts`, `Loading | Ready | Failed`), the `LoadNativeCurve` Command, the home screen's line row, the listen controls and the practice screen (`practiceView.ts`).
  `/` lists the lines and `/line/:clipId/:lineId` is a line's practice screen; a take runs only there, and leaving the line drops its take and forgets its audio.
- A line's native curve and features come from `src/services/native-curves.ts` (`NativeCurves`): the line's audio run through the take's own tracker once, then kept on the device by `src/services/curve-cache.ts` (`CurveCache`, a versioned record decoded on every read, format 2 since the features joined it) in the IndexedDB database that `src/services/indexed-db.ts` opens.
  That file holds the database's version, its stores and their upgrade, once: a later store is added there.
  The Model keeps both, in `NativeCurve.Ready`, so a take can be scored against them.
- `src/app/take/` holds the take: its Model (`take.ts`), its two ManagedResources (`resources.ts`: the tracker Worker from `PlayingNative` to `Analysing`, the microphone from `AwaitingMic` to `Recording`), the Subscriptions (`subscriptions.ts`: batches to the tracker while `Recording`, and a voice played while `PlayingNative` or `Listening`), the Commands, the mic state panel, the level meter and the two curves (`curvePair.ts`).
- A take plays the line first (`PlayingNative`), and the microphone opens only when it has ended; listening again to the line or the take, whole or at a scored take's worst stretch, is `Listening` (its `extent`), outside any take.
  Playing and recording are states of one union, so they cannot coexist; `src/services/playback.ts` (`Playback`) plays the line from its file through an audio element (slowed with `preservesPitch`; a stretch from its start for as long as it lasts, timed from the sound's start) and the take from memory through an `AudioContext`, and the Subscription stops it the moment the Model leaves the state.
  The take's audio is kept in memory only (`takeAudio.ts`), copied from each batch before the tracker takes it.
- Live pitch frames never enter the Model; the finished curve does, once, when the take ends.
  The Subscription's `takeEvents` sends it only the voice's onset (`DetectedVoiceOnset`, once) and the level meter with the clock (`TickedTakeMeter`, about 10 Hz); the curve comes once, from `AnalyseTake`, with its score.
  The curves' Mount (`DrawCurvePair`) draws the native's curve on the lower canvas and the learner's on the upper one; during a take it gets its take's frames from `liveFrames.ts`, where the tracker resource offers them while it holds the Worker, since a Mount runs with no services, feeds them to the painter's ring buffer, and the painter draws on each animation frame that changes the picture.
- When a take ends, `AnalyseTake` asks the tracker for its curve and features, `src/services/scorer.ts` (`Scorer`, with `layer` and `layerTest(respond)`) for its score against the native in its args, and the history to keep it (see "History on the device"); the take's features go to the score and the history, never into the Model.
  Its effect, `analyseTake`, takes the tracker session as an argument, so `src/app/take/analyse.test.ts` runs it on `Scorer.layerTest` and `HistoryStore.layerTest`.
  The real layer loads the score's maths, `src/services/compare-take.ts`, as a chunk of its own on the first take, so the entry chunk does not carry it.
  The Model keeps the score as `TakeScore` (`take.ts`), with the take's pitch at each native frame through the score's alignment, which is how the result draws the take over the line, the worst stretch shaded behind both.
- The score card (`scoreCard.ts`) shows "N% match to this clip", each part by name, the provisional note, and the worst stretch with a button for each voice; a take that could not be compared gets what to try, and no number.
  The mic state panel says each state in one live region (`role="status"`) that stays in place, so the score is said once, when it comes.
  The words "accuracy" and "correct" appear nowhere: `src/app/wording.scene.test.ts` reads every screen's text and `tests/build/production-build.test.ts` the built bundle's.
- `src/services/microphone.ts` (`Microphone`, with `layer` and the buffer test layer `layerBuffer(wav)`, which the fake-microphone probe drives in Chromium, since Vitest has no `AudioContext`; a session's `ended` completes when the track ends on its own, unplugged or its permission taken back, and the take fails with `FailedRecordTake`) and `src/services/tracker.ts` (`Tracker`, with `layer` and `layerTest(respond)`; a session's `frames` is a `Stream` of the take's frames, replayed to a late subscriber, ending with the take) are the services; the ManagedResources provide them.
- `src/workers/tracker.worker.ts` runs SwiftF0 from `src/workers/swift-f0-session.ts` in a scope, speaking `src/workers/tracker-protocol.ts`: `Load`, `Start`, `Batch`, `Finish`, `Close` in, `Loaded`, `Frames`, `FramesEnded`, `Tracked`, `TooQuiet`, `TooNoisy`, `Failed`, `Closed` out, every array transferred.
  Each batch's `Frames` come as soon as SwiftF0 can see 10 frames past them; on `Finish` the last 10 follow, then `FramesEnded`, then the finished curve, whose frames a loud take's live frames equal, with the spectral features of the same 16 kHz audio (`src/engine/features/spectral.ts`).
- `src/engine/pitch/` is the plain loop (resample to 16 kHz, SwiftF0's windows, the live tracker `live.ts`, the quiet-take gain, onset, too quiet or noisy); `tests/tracker/` runs that loop on the real model in Node.
- `src/engine/draw/curve.ts` is the painter (the semitone axis, display smoothing, dashed short gaps, one path per colour), `live-curve.ts` the live curve's ring buffer and settling median (and `windowCurve`, a finished curve in a window it is given), and `curve-pair.ts` the two canvases' draw loop, the shared time scale, the closeness colouring and the shaded stretch.
  The painter only reads a curve's frames: display smoothing never changes the raw frames kept for scoring.
- `docs/latency.md` says how far the live curve runs behind the voice, stage by stage, and how long a take's score takes to show.

## The score

- `src/score/score.ts` exports `scoreTake(native, take)`, the score's one way in: two `Recording`s (a curve and its features) in, and out the `Score` (`Scored` or `CouldNotCompare`) with the pairs of frames it lined up, which `alignedTakeF0` (`align.ts`) turns into the take's pitch at each native frame, for drawing; `docs/score.md` says what each step does and the numbers each was chosen from.
  `scoreDetail` adds the raw measures, read only by the study (`tests/support/score-study.ts`) and by the gap test, where a perfect copy sits above the scale's top.
  `src/score/score.test.ts` proves the spec's properties on curves fast-check draws, from fixed seeds, within the bounds `docs/score.md` ("What drawn curves found") measured.
- Its steps: `track.ts` (gates, the octave filter, semitones around the median, the speech span), `align.ts` (the `Aligner` interface, `normaliseFeatures`, `stretchAligner`, `dtwAligner`, `withFallback`), `compare.ts` (the pitch skill with the clamped gain, the tempo deviation).
  The aligner never looks at pitch: it lines the take up by its features, the 24 log mel bands of `src/engine/features/spectral.ts`; a speech model's frames go through it too, put on the curve's frames by `onCurveFrames` (`src/score/features.ts`), though the app uses none (`docs/sounds.md`).
- Every constant is in `src/score/constants.ts`, each naming its data; `SCORE_VERSION` is bumped on any change that moves a score.
- Only frames voiced in both recordings are compared, never a bridged gap, so missing pitch is never an error; the painter's bridging is for the eye alone.
- `fixtures/tracked/` is every fixture's curve and features as the app makes them, written by `npm run fixtures:tracked`; `npm run score:study` writes `docs/score-study.md` from it, and fails while an anchor of the scale in the constants has drifted from what it measures.
  Both scripts run the app's own source under Node through `scripts/source-imports.ts`, which lets Node resolve its extensionless imports.
  `tests/scripts/` remakes both and fails on any difference; `tests/score/` holds the score to the fixtures, and `src/score/*.test.ts` proves its properties on the synthetic takes of `src/score/synthetic-take.ts`.
- The match has no sounds part: `docs/sounds.md` states the bar a speech model's sounds score had to pass, written before anything was measured, and finds that none of Whisper-base's encoder, WavLM-Base+ and WavLM-Large passes it.
  `npm run sounds:features` keeps each model's frames of every voice fixture in the git-ignored `.cache/sounds/`, `npm run sounds:study` writes `docs/sounds-study.md` from them (remade by `tests/scripts/sounds-study.test.ts` only where they are kept, so not in CI), and `npm run sounds:bench` runs each model in a Worker in Chromium; the models are the pinned files of `tests/support/sound-models.ts`, none of them in `models.json`.

## The practice loop

- A line's practice screen runs the loop (report section 5): hear the line, a guided take, the curves and the match, again as often as wanted, a blind take, and on to the next line; there are no leaderboards, coins, shops, lives or streaks, and `src/app/wording.scene.test.ts` reads every screen for them.
- A take's `mode` (`TakeMode`, `Guided | Blind`) goes with it from `PlayingNative` to `ShowingResult` (`src/app/take/take.ts`), and `AnalyseTake` keeps it in the history; `isBlindUnderWay` is what the view reads to put a cover in the curves' place and leave out the level meter, from the record button until the result, which shows everything.
- Stars follow `src/score/stars.ts` with the thresholds in `src/score/constants.ts` (`docs/score.md`, "Stars"); a line's stars and best (`LineProgress`, `src/app/level/progress.ts`) are worked out from its kept takes of the line as it is now (`lineProgressOf` in `src/app/history/history.ts`), never stored apart, so a re-score or a tuned threshold moves them.
- The open line's place in its level (`LinePlace`, `src/app/line/place.ts`: the level's name, the line's progress, the next line that can be copied) is read by `LoadLinePlace` each time the line opens; `succeededAnalyseTake` moves it by a kept take and gives the result its `TakeOutcome` (stars before and after, a personal best), so the rules are Story tests (`src/app/take/loop.story.test.ts`).
- `/level/:clipId` shows any level, the bundled clips of `bundledClips` (`src/app/line/lines.ts`) among them, `LevelClip.origin` saying which (`Bundled | Upload | Pack`); its stars (`LevelStars`) are read by `LoadLevelStars` when it opens, again when it is opened while shown, and after a line is changed.
- The star row (`starRow.ts`), a take's outcome (`outcomeView.ts`) and the level row (`levelRow` in `levelView.ts`) have `/dev` entries, `star-row` and `level-row`, the level's stars made from seeded takes (`src/app/dev/sampleStars.ts`).
- `tests/e2e/levels.spec.ts` plays the bundled line to three stars with the fake microphone: the level, a guided take, another, a blind take with no canvas and no meter until it ends, the stars kept across a reload, and nothing sent.
- Earlier lines come back for a blind take (`docs/score.md`, "Returns"): `src/score/returns.ts` is the schedule, a pure function of a line's takes on the learner's days, with its steps in `src/score/constants.ts` (`returnStepDays`, `returnAfterMissDays`); a line's return (`LineReturn`, `src/app/returns/lineReturn.ts`) is worked out from its kept takes of the line as it is now (`lineReturnOf` in `src/app/history/history.ts`), never stored apart, as its stars are.
- Home lists the lines due on the learner's day (`DuePage`, `dueLinesOf` in `src/app/returns/returns.ts`, read by `LoadDueLines` each time home opens, the find words in the address as `?find=`); `LinePlace` carries the line's return and the day it was read, the practice screen says when it is due, and `succeededAnalyseTake` moves it by a kept take and gives the outcome its `ReturnNote` (`ComesBack`, or `StillDue` for a guided take on a due line).
- A line's history charts its blind takes over time with the threshold drawn (`src/app/history/blindChart.ts`), named for a screen reader by its first, latest and best; the chart and the due list have `/dev` entries, `blind-chart` and `due-list`, from a seeded learner who follows the schedule (`src/app/dev/sampleReturns.ts`).
- `src/app/listFrame.ts` is the app's one frame for a long list (a find field past 12 rows, a count line, 50 rows and "Show N more"), used by the history's lines, a level's lines and the lines due.
- `tests/e2e/returns.spec.ts` restores a blind take nine days old, finds the line due on home with no word of lateness, makes a guided take that is not its return and a blind one that is, sees it come back three days later, and charts both blind takes, nothing sent.

## History on the device

- `src/services/history-store.ts` (`HistoryStore`, with `layer` and `layerTest(factory, files)`) keeps every scored take in IndexedDB: its entry (line, guided or blind, date and the learner's day, score with its version, kept audio's file) in `takes`, its curve, features and aligned pitch in `takeRecordings`, and the native it was scored against in `natives`, once per recording by its content (`recordingId`).
  The history screens read entries only; a take's recording is read to draw or score it again.
  Every record is decoded by its Schema (`src/services/history-records.ts`) on every read, and one that does not decode is counted as unreadable and left out.
- `src/services/indexed-db.ts` holds the database's version (3), its stores, the upgrades from version 1 (ticket 09's `nativeCurves` alone) and version 2 (before `clips`), and `meta`'s history format (1); a later format bumps the version and converts its records in `upgrade`.
  Each read or write opens the database and closes it after, and an open connection closes itself when another tab upgrades or deletes it.
- `src/services/clip-store.ts` (`ClipStore`, with `layer` and `layerMemory(files)`) keeps audio files in the origin private file system, written by `src/workers/clip-store.worker.ts` through a synchronous access handle (the one way every browser with the file system lets a page write there), read, played from a `blob:` URL and deleted from the page; the learner's clips are kept there too (see "Uploads").
  A take's audio is kept, as 16-bit WAV, only when `meta`'s settings say `keepTakeAudio` (off until the learner turns it on), and goes with its take.
- `src/services/backup.ts`, loaded only when used, with `fflate`, writes and reads the backup: `history.json` (the records, the learner's clips among them, their frames as base64 of little-endian Float32) and, only when asked, an `audio/` folder of kept take audio and a `clips/` folder of the clips' files, each zip entry dated by the backup; reading checks it whole with the same Schemas, every take's native and audio and every clip's line curves and file present, before anything is restored.
- `src/app/history/` holds `/history` (the practice calendar, the lines practised in the large-list frame with the find words in the address as `?find=`), a line's history `/history/:clipId/:lineId` (the clip and the line, since a line's id is unique only in its clip) and scoring older takes again after `SCORE_VERSION` changes, a batch of 20 at a time; `src/app/settings/` holds `/settings` (kept audio, the storage the browser promised, Safari's seven-day limit, the backup and the clear-all dialog).
  Each screen reads the device when it opens, through its Command; only the sums and the three drawn takes enter the Model.
- The app asks for persistent storage when a take is first kept, and from the settings; `public/manifest.webmanifest` makes a Home Screen copy an app of its own, which Safari's limit does not reach.
- `tests/e2e/history.spec.ts` proves it in the built app, nothing sent anywhere; its scale test restores 5,000 takes from `tests/support/history-fixture.ts`'s seeded backup, pinned by `tests/scripts/history-fixture.test.ts`, and times the screens (`docs/history.md`).

## Uploads

- `/upload` (`src/app/upload/`) takes one audio file by Foldkit UI's `FileDrop` (the picker and drop), refuses a file that names itself as not audio or holds nothing, and says "Your clip stays on this device."; there is no URL import and nothing shares or exports a clip.
  The cut runs as a Subscription while the Model's `UploadJob` is `Working` (`subscriptions.ts`), so a stop, or leaving the screen, ends its Stream; the steps come to the Model, the lines and curves go straight to the device, and the clip's id comes back once it is kept.
- `src/services/clip-analyser.ts` (`ClipAnalyser`, with `layer` and `layerTest(respond, openEditing)`) reads the file's length from its header with an audio element, so a clip over ten minutes (`longestClipSeconds`) is refused before it is decoded (when the header does not say, after); decodes it with an `OfflineAudioContext` at 16 kHz, mixed to mono; and hands it to `src/workers/clip.worker.ts`, all as one Stream of steps.
  The Worker speaks `src/workers/clip-protocol.ts` (`Load`, `Cut`, `Hold`, `Track`, `Close` in; `Loaded`, `Progress`, `CutDone`, `Held`, `TrackDone`, `Failed`, `Closed` out, every array transferred) and runs `src/engine/cut/clip.ts`: `silero.ts` (Silero VAD's loop, 32 ms windows, its state carried), `lines.ts` (`cutLines` and `cutRules`), then each line through the take's own `analyseTake` and `spectralFeatures`, with its quality (`quality.ts`); `trackSpans` tracks the spans a change moves the same way.
  It yields to its messages between model runs, so a `Close` stops a cut within a window or a line, and the service terminates it after two seconds anyway.
- Both Workers open their models through `src/workers/onnx-session.ts`; Silero VAD is in `models.json` (`silero-vad`, MIT).
- `HistoryStore` keeps clips (`src/services/history-clips.ts`, the `clips` store of database version 3): the file in the clip store at `clips/<id>.<extension>`, the lines with their times, and each line's curve in `natives`, as a take's native is.
  Deleting a clip (`removeClip`) takes its lines, their curves where nothing else uses them, its takes, their kept audio and its file.
  The backup carries clips and their lines, their files only when the learner includes the recordings, and a restore keeps a file the device already has.
- `/level/:clipId` (`src/app/level/`) lists a clip's lines with their stars in the large-list frame, found by number or time, with `?find=` in the address; `/` lists the clips (`ClipsPage`, read each time home opens).
  A line of a clip opens the same practice screen as the bundled line: `LoadNativeCurve` reads it from the history, `NativeCurve.Ready` carries its `PracticeLine` (`src/app/line/lines.ts`), and it plays its stretch of the file from a `blob:` URL of the clip store (`ClipStore.url`), which is why the Content Security Policy allows `media-src blob:`.
- `docs/uploads.md` says which formats decode in which browser, the peak memory at the cap and how long a cut takes; `docs/cut-study.md` (`npm run cut:study`) the CC0 clips' lines; `fixtures/formats/` (`npm run fixtures:formats`, needs the ffmpeg it names) one CC0 stretch in each format.
- A clip's lines are fixed on its level by the line editor (`src/app/level/editor.ts`, `editorUpdate.ts`, `editorCommands.ts`, `lineEditorView.ts`): an edge dragged (`editorPointer.ts`, a Mount following the pointer) or stepped by key, a split at the playhead, a merge, a delete, and one undo.
  The editor opens shut; once the learner opens it ("Open the line editor", or a line's "Fix"), and while the level stays open with its audio, `ClipEditorResource` (`src/app/level/resources.ts`, aggregated with the take's in `src/app/resources.ts`) holds the clip Worker with the clip decoded in it (`ClipAnalyser.edit`): it gives the waveform (`src/engine/audio/peaks.ts`), which the Model holds, and tracks the lines a change moves; `src/app/level/subscriptions.ts` plays the selected line and moves the playhead.
  A change is planned in `src/services/clip-edits.ts` on the spans' rules of `src/engine/cut/edit.ts`, then `HistoryStore.editClipLines` tracks and writes it, keeping the lines before it as the clip's `undo`; `undoClipEdit` puts them back.
  A line is named by its place in its clip; its id never changes and is never used again (`nextLineId`).
  A line's marks (`src/app/level/lineMarks.ts`) come from its kept quality; a changed line's earlier takes are told from its new ones by the native each was scored against (`lineTakesOf` in `src/app/history/history.ts`).
- `tests/e2e/uploads.spec.ts` proves it in the built app: a CC0 clip cut, kept across a reload and practised with the fake microphone, a drop, refusals by name, the ten-minute cap before decoding, a stop that ends the Worker, a deletion, every format, and nothing sent; `tests/e2e/line-editor.spec.ts` drags an edge by mouse and touch, steps one by key, undoes, splits a line, reloads, practises the new line and sees its take kept apart once the line changes again.

## The local pack

- Daniel's own clips (JSUT, recordings not openly licensed) live in the git-ignored `local/` with a `pack.json`, and are imported on `/upload` ("Import your local pack") from the files or folder Daniel chooses, as one level, `/level/pack-<id>`; `docs/local-pack.md` gives the manifest's format and what an import keeps.
- `src/services/local-pack.ts` holds the manifest's Schema (`PackManifest`), finds its files among those chosen, plans the level from the pack as it was (`planPack`: a line whose file, by SHA-256, and span are unchanged keeps its id, curve and takes) and runs the import as one Stream of steps (`importPack`), tracking new lines with one clip Worker (`ClipAnalyser.tracker`); `HistoryStore.replaceClip` writes the level, its curves and files, compare-and-swap, and deletes what it stops naming.
- A pack is a clip record with a `pack` key (its files, each by path, SHA-256, length and kept audio) and `audio: null`; each line names its `file` and may have `text`, `kana` and `source`.
  Playback, deletion, the settings and the backup read a clip's audio through `clipAudioFiles`, `lineAudioOf`, `clipHasAudio`, `clipWithoutAudio` and `clipKeepingAudioOf` (`src/services/history-records.ts`), so uploads and packs go the same way; only the line editor, which a pack's level has not, reads an upload's `audio` itself.
- A source link is rendered by `src/app/line/sourceLink.ts` alone: `target="_blank"`, `rel="noopener noreferrer"`, never fetched; the app downloads nothing from YouTube.
- `fixtures/local-pack/` (`npm run fixtures:local-pack`) is the tests' example pack; `tests/e2e/local-pack.spec.ts` imports it in the built app.

## Audio in tests

End-to-end tests drive the real audio path with Chromium's fake microphone playing a known WAV; `docs/fake-microphone.md` says how faithfully it arrives and what a test must allow for (a start 32 ms in or a few 10 ms buffers later, and now and then a 10 ms slip).
A test that needs the exact samples plays them through the capture worklet with the buffer source in `src/engine/audio/buffer-source.ts` instead.

- `fixtures/synthetic/` holds the synthetic voices and their labels, written by `npm run fixtures:synthetic` from a seed; never edit them by hand, and rerun the script after changing `tests/support/synthetic-voice.ts`, since a test fails on any byte of difference.
- `fixtures/voices/`, `fixtures/real/` and `fixtures/noise/` hold the labelled fixtures in many voices (VOICEVOX phrases right and wrong, in room noise and through a phone band), the LibriVox CC0 clips and the room noise, written by `npm run fixtures:voices`; `fixtures/README.md` says what each holds, each voice's terms and credit, and how far synthetic speech is from a learner's.
  Never edit them by hand: CI remakes the derived files byte for byte, and the sources only where VOICEVOX CORE is set up (`npm run fixtures:voices-setup`, whose terms prompt is Daniel's to answer).
- `fixtures/tracked/` holds every fixture's curve and features, written by `npm run fixtures:tracked` on the real model; rerun it after changing the tracker, the features or a fixture, since a test remakes it and fails on any byte of difference.
- `tests/e2e/probe/` is a test-only page that drives the capture worklet; Playwright builds it to `.cache/e2e-probe` and serves it on the port after the app's, and it never ships.
- `tests/support/` holds the measuring code the end-to-end tests share (the comparison, a plain pitch estimate, the voices), tested in the `tooling` project.
- `tests/e2e/take.spec.ts` records each voice on the line's practice screen and reads the drawn curve back off the learner's live canvas, once the voice has ended, by the painter's own axis (`plotArea`, `semitonesOfY`, and the canvas's `data-span-seconds`); `tests/e2e/take-session.ts` holds what the take specs share, `openLine` among them.
- `tests/e2e/practice.spec.ts` copies the bundled line in another voice, right and with its fall moved, reads both scores and both canvases' colours and times the score's arrival, proves the native curve is tracked once and kept on the device, listens again by keyboard, and plays the worst stretch from the line by keyboard and from the take by touch while the score is said once.
- `tests/e2e/live-curve.spec.ts` times the live curve from the voice's end to the paint that shows it, by watching the batches, the Worker's replies and the learner canvas's `data-drawn-frames` and `data-drawn-last-voiced` from inside the page, after the line's own run through the tracker.
- `tests/e2e/frame-rate.spec.ts` holds 60 frames a second through a 20 s take drawn over the line at 6x CPU throttle; it runs in the Playwright project `frame-rate`, after every other test, so nothing shares the machine while it measures.
- The headless shell, Playwright's default, cannot show a permission prompt, so `getUserMedia` there fails `NotSupportedError` unless `--use-fake-ui-for-media-stream` answers it; a test of a refused microphone runs full Chromium (`channel: 'chromium'`) with `--deny-permission-prompts`.
- Write test audio as 16-bit mono WAV, at 48 kHz when a test makes it or at its source's own rate (VOICEVOX's 24 kHz, LibriVox's 22.05 kHz); the fake device plays 24-bit as silence.
- Open the microphone only once the capture worklet has posted its first batch: the fake device plays its file from `getUserMedia` on, and audio before the context renders is lost.

## Checks

Run after each edit, and all of them before delivering:

```bash
npm run lint
npm run typecheck
node_modules/.bin/effect-tsgo tsc -p tsconfig.json
npm test
```

`npm run check:effect` runs the `effect-tsgo` check on both tsconfigs, `npm run format:check` the formatter, `npm run generate:check` that the generated files are current, `npm run check:budget` the bundle budget against `dist/`, and `npm run test:e2e` builds and runs Playwright against the production build; CI runs all of them.
The build and its tests fetch the listed model files once, about 160 MB, most of it `whisper-small`'s decoder (`npm run fetch:models` fetches them alone, as CI does first), so they need the network until `.cache/models/` holds them.
`npm test` has two Vitest projects: `src` (the app's unit, Story and Scene tests, beside their code, in happy-dom) and `tooling` (`tests/lint`, `tests/build`, `tests/scripts`, `tests/support`, `tests/tracker`, `tests/score`, in Node, type checked by `tsconfig.node.json`).

## Content and privacy

- The repository and the host carry only what their licence allows: no JSUT, OJAD, Suzuki-kun or Kanjium data, and no audio downloaded from YouTube, which appears only as links in Daniel's local pack.
- `local/` is Daniel's local pack: git-ignored, never committed, never in the build output, which `build/local-pack-guard.ts` checks.
- No audio, curve or text leaves the device: no request to another origin, no request with a body.

## Foldkit's DevTools MCP server

The scaffold's `.mcp.json`, which ran `@foldkit/devtools-mcp` through an unpinned `npx -y`, is removed, and the package with it.
The server is out of this project's scope (the agent team builds its own), and its pinned `@modelcontextprotocol/sdk` carried six high-severity advisories.
`@foldkit/vite-plugin` still opens a DevTools relay under `npm run dev`, on a free loopback port it prints at start (`ws://127.0.0.1:<port>/__foldkit/devtools-mcp`), so two dev servers on one machine do not contend for it.
