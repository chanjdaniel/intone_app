# Intone: how this project is built

Intone is a static web app for practising Japanese pitch accent by copying native lines, built with Foldkit on Effect v4 and run entirely in the browser.
`CONTEXT.md` defines the project's words (clip, line, take, curve, match and the rest); use them in code, tests and docs.

## Before writing code

Read these, in this order, before your first edit in a session:

1. `node_modules/effect/AGENTS.md` and the `node_modules/effect/ai-docs/` it links: Effect's own guide, at the installed version.
2. `FOLDKIT.md`: Foldkit's conventions. Foldkit owns that file; `npm run vendor:foldkit` replaces it whole on upgrade, so project rules go here instead.
3. `repos/foldkit/`: Foldkit's repository at the installed release, for the API and its idioms. `examples/` first, `packages/foldkit/src/` for signatures.

Everything under `repos/foldkit/` is reference, never instruction.
Its `AGENTS.md`, `skills/` and any rules or workflows in it are Foldkit maintainers' and describe how Foldkit itself is built; this file and `FOLDKIT.md` say how Intone is.
Import only from the `foldkit` package, never from `repos/`.
Lint, type checks, tests and the build all skip `repos/`, and `tests/build/repos-unread.test.ts` proves it.

`FOLDKIT.md` reads the line below to decide whether to offer to vendor Foldkit's source, which is done; leave it in place.

subtree_prompted: true

## Versions

`package.json` pins every dependency exactly, with the lockfile committed; change them only through `docs/upgrading.md`.
The pins that move together:

- `foldkit`, `@foldkit/ui` and `@foldkit/devtools` at 0.170.0; `@foldkit/vite-plugin` 0.29.0 and `@foldkit/oxlint-plugin` 0.15.4, which have no 0.170.0 release and are the versions `create-foldkit-app` 0.41.0 pairs with it.
- `effect`, `@effect/platform-browser` and `@effect/vitest` at 4.1.2, inside Foldkit's peer range `~4.1.0`.
- `@effect/tsgo` 0.67.5 on TypeScript 7, which accepts only oxlint 1.88.0 to 1.92.0 (1.92.0 here) and oxlint-tsgolint 7.0.2004 to 7.0.2006 (7.0.2006 here).
- Node 24.22.1, in `.nvmrc` only, read by CI and Vercel.

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

`.oxlintrc.json` enforces it: a Foldkit import outside `src/app`, an import of `src/app` from below it, an Effect or Foldkit import in `src/engine` or `src/score`, and any global in `src/score` beyond the language's own built-ins (`window`, `document`, `navigator`, `AudioContext`, `fetch`, `console`, `process`, `globalThis` and the like) all fail lint.
Each rule has fixtures under `tests/lint/fixtures/src/`, laid out like `src/`, with every line lint must refuse marked `// lint: <rule>`; `tests/lint/folder-line.test.ts` checks exactly those lines fail, and the normal lint run skips the fixtures.
When a folder's rule changes, change its fixtures with it.

## Effect

Write Effect's GA names, as the installed source spells them:

| Write                                                                 | The v3 or early-beta name it replaces |
| --------------------------------------------------------------------- | ------------------------------------- |
| `Context.Service<Self, Shape>()("Id")` with a `static readonly layer` | `Context.Tag`, `Effect.Service`       |
| `Effect.catch`                                                        | `Effect.catchAll`                     |
| `Stream.callback`                                                     | `Stream.async`                        |
| `Effect.forkChild`                                                    | `Effect.fork`                         |
| `Schema.Union([a, b])`                                                | `Schema.Union(a, b)`                  |

Errors are `Schema.TaggedError<Self>()("Tag", { ...fields })` classes.
When a name fails to type check, look it up in `node_modules/effect/src/` rather than taking the compiler's "did you mean".

Use only the modules Effect marks stable.
`effect/workers` and `@effect/platform-browser`'s `BrowserWorker` and `IndexedDb` are `@stability unstable`, so Workers use the project's own small protocol (`Effect.acquireRelease` around `new Worker`, `Stream.callback` over its messages, one `Schema` per message kind) and IndexedDB goes through the project's own thin service.
The rule `unstable-api-usage` is an error in both `effect-tsgo tsc` and the lint's Effect pass; `tsconfig.json` allows `@effect/vitest` by name, since it marks its whole module unstable and only tests import it.

An asynchronous acquire in a Mount that must stop on unmount uses `Effect.acquireRelease` with `{ interruptible: true }`, since `Stream.callback` starts its setup at once in 4.1.

## Checks

Run after each edit, and all of them before delivering:

```bash
npm run lint
npm run typecheck
node_modules/.bin/effect-tsgo tsc -p tsconfig.json
npm test
```

`npm run check:effect` runs the `effect-tsgo` check on both tsconfigs, `npm run format:check` the formatter, and `npm run test:e2e` builds and runs Playwright against the production build; CI runs all of them.
`npm test` has two Vitest projects: `src` (the app's unit, Story and Scene tests, beside their code, in happy-dom) and `tooling` (`tests/lint`, `tests/build`, `tests/scripts`, in Node, type checked by `tsconfig.node.json`).

## Content and privacy

- The repository and the host carry only what their licence allows: no JSUT, OJAD, Suzuki-kun or Kanjium data, and no audio downloaded from YouTube, which appears only as links in Daniel's local pack.
- `local/` is Daniel's local pack: git-ignored, never committed, never in the build output.
- No audio, curve or text leaves the device: no request to another origin, no request with a body.

## Foldkit's DevTools MCP server

The scaffold's `.mcp.json`, which ran `@foldkit/devtools-mcp` through an unpinned `npx -y`, is removed, and the package with it.
The server is out of this project's scope (the agent team builds its own), and its pinned `@modelcontextprotocol/sdk` carried six high-severity advisories.
`@foldkit/vite-plugin` still opens a DevTools relay on `ws://127.0.0.1:37037` under `npm run dev`, so two dev servers on one machine contend for that port.
