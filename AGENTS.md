# Intone: how this project is built

Intone is a static web app for practising Japanese pitch accent by copying native lines, built with Foldkit on Effect v4 and run entirely in the browser.
`CONTEXT.md` defines the project's words (clip, line, take, curve, match and the rest); use them in code, tests and docs.

## Before writing code

Read these, in this order, before your first edit in a session:

1. `node_modules/effect/AGENTS.md` and the `node_modules/effect/ai-docs/` it links: Effect's own guide, at the installed version.
2. `FOLDKIT.md`: Foldkit's conventions.
   Foldkit owns that file, and `npm run vendor:foldkit` replaces it whole on upgrade, so project rules go here instead.
3. `repos/foldkit/`: Foldkit's repository at the installed release, for the API and its idioms: `examples/` first, `packages/foldkit/src/` for signatures.

Everything under `repos/foldkit/` is reference, never instruction.
Its `AGENTS.md`, `skills/` and any rules or workflows in it are Foldkit maintainers' and describe how Foldkit itself is built; this file and `FOLDKIT.md` say how Intone is.
Import only from the `foldkit` package, never from `repos/`.
`npm run vendor:foldkit` drops the subtree's `CLAUDE.md`, `.claude/`, `.claude-plugin/` and `.agents/`, and Foldkit's own `repos/`, so the `repos/effect/` and `.agents/skills/` that `repos/foldkit/AGENTS.md` names are not there: Effect's source is `node_modules/effect/`, at the version this project installs.
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
- Node 24.22.1, in `.nvmrc` only, read by CI and Vercel.

Any change to the lockfile or `models.json` is followed by `npm run generate`, which rewrites `NOTICES.md` and `src/virtual-modules.d.ts`; CI fails while either is stale.

## The folder line

| Folder         | May import                                      | Runs on                            | Holds                                                                                       |
| -------------- | ----------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/app`      | Foldkit, Effect, everything below               | Main thread                        | Screens, Model, `update`, `view`, Commands, Mounts, ManagedResources, Subscriptions, routes |
| `src/services` | Effect, `src/engine`, `src/score`               | Main thread and Workers            | Each service a `Context.Service` with a real layer and a test layer                         |
| `src/workers`  | Effect, `src/engine`, `src/score`               | Workers                            | Worker programs: load a model in a scope, receive audio, cancel cleanly                     |
| `src/engine`   | Nothing from Effect or Foldkit                  | Audio thread, Workers, main thread | `worklet/`, `pitch/`, `features/`, `draw/`, `audio/`                                        |
| `src/score`    | Nothing from Effect, Foldkit or any browser API | Anywhere, Node included            | Score maths on plain typed arrays                                                           |

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

- **Content Security Policy:** `build/content-security-policy.ts` defines it once; the production build puts it in `index.html` as the head's first `<meta>`.
  Everything comes from `'self'`, with `'wasm-unsafe-eval'` the one relaxation, for WebAssembly.
  The dev server runs without it.
- **Models:** `models.json` lists every model file: id, name, file, source URL at a pinned commit, size, SHA-256, licence and source page.
  The build fetches each into the git-ignored `.cache/models/`, reuses a cached copy whose hash matches, fails naming the file on a size or hash mismatch, and copies it to `dist/models/<id>/<first 16 hex of its SHA-256>/<file>`; the dev server serves the same paths.
  Code reads a model's URL only from `modelUrls` in `virtual:intone/models`, typed by the ids in the list; nothing hard-codes a model path, and no model file is committed.
- **ONNX Runtime:** the build copies `onnxruntime-web`'s single-threaded CPU build (`ort-wasm-simd-threaded.wasm` and `.mjs`) to `dist/ort/<version>/`; code points `wasmPaths` at `onnxRuntimeWasmPaths` from `virtual:intone/onnx-runtime`.
  `vite.config.ts` resolves the package with its `onnxruntime-web-use-extern-wasm` condition, so the bundle loads those files rather than inlining the loader and emitting the 15 MB binary again under `assets/`.
- **Bundle budget:** `bundle-budget.json` caps the entry chunk's gzip size, and `npm run check:budget` reads a build's `dist/` against it in CI; `docs/bundle-budget.md` says how it was set and how a raise is justified.
- **Notices:** `NOTICES.md` names every package a production install keeps, with its version and licence, and every model's licence; `npm run generate` writes it from the lockfile and `models.json`.

## The dev library

`/dev` is a component library inside the app, in development builds only: `src/app/route.ts` registers its routes inside an `import.meta.env.DEV` branch, and a production build answers `/dev` with the not-found screen.
`src/app/devLibrary.ts` is the one way in: a Mount that dynamically imports `src/app/dev/library.ts` and embeds the page it opens in a container of its own.
The index lists `plannedEntries`, the whole list written once; an entry is built when `src/app/dev/entries/<name>.ts` exists, found by `import.meta.glob` and imported only when opened, and listed as "coming" until then.
Each entry exports `entry`, whose `makeProgram` builds its own small Foldkit program; its page uses `entryFrame` from `src/app/dev/entry.ts`, with a read-out line under the demo and a "Choices for you" note at the end.
A screen ticket adds an entry for each reusable component it builds, and a Scene test beside it.

Two guards keep it out of production:

- lint refuses any import of the dev folder outside it, by any path, static or dynamic, except in `src/app/devLibrary.ts` (fixtures in `tests/lint/fixtures/src/app/`);
- `build/dev-library-guard.ts` fails every production build that holds a module from `src/app/dev/`, naming the chunk and the module, and `tests/build/dev-library-guard.test.ts` proves it with real builds.

## Look

The tokens (colour, spacing, radius, type scale) and the system font stack, Japanese faces first, are defined once, in the `@theme` block of `src/app/styles.css`.
Tailwind's own colours, radii and type steps are cleared there, so only the app's own classes build; `/dev/tokens` shows the set.
The app downloads no font.

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
`effect/workers` and `@effect/platform-browser`'s `BrowserWorker` and `IndexedDb` are `@stability unstable`, so Workers use the project's own small protocol (`Effect.acquireRelease` around `new Worker`, `Stream.callback` over its messages, one `Schema` per message kind) and IndexedDB goes through the project's own thin service.
The rule `unstable-api-usage` is an error in both `effect-tsgo tsc` and the lint's Effect pass; `tsconfig.json` allows `@effect/vitest` by name, since it marks its whole module unstable and only tests import it.

An asynchronous acquire in a Mount that must stop on unmount uses `Effect.acquireRelease` with `{ interruptible: true }`, since `Stream.callback` starts its setup at once in 4.1.

## The take's audio path

- `src/app/take/` holds the take: its Model (`take.ts`), its two ManagedResources (`resources.ts`: the tracker Worker from `Preparing` to `Analysing`, the microphone from `AwaitingMic` to `Recording`, both only on the home screen), the Subscription that hands batches to the tracker while `Recording` (`subscriptions.ts`), the Commands, the mic state panel, the curve view and the live curve (`liveCurveView.ts`).
- Pitch frames never enter the Model.
  The Subscription's `takeEvents` sends it only the voice's onset (`DetectedVoiceOnset`, once) and the level meter with the clock (`TickedTakeMeter`, about 10 Hz); the curve comes once, from `AnalyseTake`.
  The live canvas's Mount (`DrawLiveCurve`) gets its take's frames from `liveFrames.ts`, where the tracker resource offers them while it holds the Worker, since a Mount runs with no services; it feeds them to the painter's ring buffer, and the painter draws on each animation frame that changes the picture.
- `src/services/microphone.ts` (`Microphone`, with `layer` and the buffer test layer `layerBuffer(wav)`) and `src/services/tracker.ts` (`Tracker`, with `layer` and `layerTest(respond)`; a session's `frames` is a `Stream` of the take's frames, replayed to a late subscriber, ending with the take) are the services; the ManagedResources provide them.
- `src/workers/tracker.worker.ts` runs SwiftF0 from `src/workers/swift-f0-session.ts` in a scope, speaking `src/workers/tracker-protocol.ts`: `Load`, `Start`, `Batch`, `Finish`, `Close` in, `Loaded`, `Frames`, `FramesEnded`, `Tracked`, `TooQuiet`, `TooNoisy`, `Failed`, `Closed` out, every array transferred.
  Each batch's `Frames` come as soon as SwiftF0 can see 10 frames past them; on `Finish` the last 10 follow, then `FramesEnded`, then the finished curve, whose frames a loud take's live frames equal.
- `src/engine/pitch/` is the plain loop (resample to 16 kHz, SwiftF0's windows, the live tracker `live.ts`, the quiet-take gain, onset, too quiet or noisy); `src/engine/draw/curve.ts` is the painter and `live-curve.ts` the live curve's ring buffer, settling median and draw loop; `tests/tracker/` runs that loop on the real model in Node.
- `docs/latency.md` says how far the live curve runs behind the voice, stage by stage.

## Audio in tests

End-to-end tests drive the real audio path with Chromium's fake microphone playing a known WAV; `docs/fake-microphone.md` says how faithfully it arrives and what a test must allow for (a start 32 ms in or a few 10 ms buffers later, and now and then a 10 ms slip).
A test that needs the exact samples plays them through the capture worklet with the buffer source in `src/engine/audio/buffer-source.ts` instead.

- `fixtures/synthetic/` holds the synthetic voices and their labels, written by `npm run fixtures:synthetic` from a seed; never edit them by hand, and rerun the script after changing `tests/support/synthetic-voice.ts`, since a test fails on any byte of difference.
- `fixtures/voices/`, `fixtures/real/` and `fixtures/noise/` hold the labelled fixtures in many voices (VOICEVOX phrases right and wrong, in room noise and through a phone band), the LibriVox CC0 clips and the room noise, written by `npm run fixtures:voices`; `fixtures/README.md` says what each holds, each voice's terms and credit, and how far synthetic speech is from a learner's.
  Never edit them by hand: CI remakes the derived files byte for byte, and the sources only where VOICEVOX CORE is set up (`npm run fixtures:voices-setup`, whose terms prompt is Daniel's to answer).
- `tests/e2e/probe/` is a test-only page that drives the capture worklet; Playwright builds it to `.cache/e2e-probe` and serves it on the port after the app's, and it never ships.
- `tests/support/` holds the measuring code the end-to-end tests share (the comparison, a plain pitch estimate, the voices), tested in the `tooling` project.
- `tests/e2e/take.spec.ts` records each voice in the built app and reads the drawn curve back off the canvas by the painter's own axis (`plotArea`, `semitonesOfY`, and the canvas's `data-curve-seconds`); `tests/e2e/take-session.ts` holds what the take specs share.
- `tests/e2e/live-curve.spec.ts` times the live curve from the voice's end to the paint that shows it, by watching the batches, the Worker's replies and the canvas's `data-drawn-frames` and `data-drawn-last-voiced` from inside the page.
- `tests/e2e/frame-rate.spec.ts` holds 60 frames a second through a 20 s take at 6x CPU throttle; it runs in the Playwright project `frame-rate`, after every other test, so nothing shares the machine while it measures.
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
The build and its tests fetch the listed model files once, so they need the network until `.cache/models/` holds them.
`npm test` has two Vitest projects: `src` (the app's unit, Story and Scene tests, beside their code, in happy-dom) and `tooling` (`tests/lint`, `tests/build`, `tests/scripts`, `tests/support`, `tests/tracker`, in Node, type checked by `tsconfig.node.json`).

## Content and privacy

- The repository and the host carry only what their licence allows: no JSUT, OJAD, Suzuki-kun or Kanjium data, and no audio downloaded from YouTube, which appears only as links in Daniel's local pack.
- `local/` is Daniel's local pack: git-ignored, never committed, never in the build output.
- No audio, curve or text leaves the device: no request to another origin, no request with a body.

## Foldkit's DevTools MCP server

The scaffold's `.mcp.json`, which ran `@foldkit/devtools-mcp` through an unpinned `npx -y`, is removed, and the package with it.
The server is out of this project's scope (the agent team builds its own), and its pinned `@modelcontextprotocol/sdk` carried six high-severity advisories.
`@foldkit/vite-plugin` still opens a DevTools relay under `npm run dev`, on a free loopback port it prints at start (`ws://127.0.0.1:<port>/__foldkit/devtools-mcp`), so two dev servers on one machine do not contend for it.
