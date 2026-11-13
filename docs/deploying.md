# Serving and deploying Intone

Intone is a static app: a host serves the files `vite build` writes to `dist/`, and everything else runs in the browser.
Nothing is hosted today.
Daniel shelved the deploy on 2026-11-12, until their word, and runs the app on their own PC.
The two local servers serve the app exactly as a later host must, so the deploy changes where the app runs and nothing in it.

## How the app is served today

- **The dev server**, `npm run dev`, at `http://localhost:5173`, for building the app; it serves model files from the cache in `.cache/models/`, fetching a missing one on its first request.
- **The local production build**, `vite build` served by `vite preview`, from `dist/`; the end-to-end tests run against it at `http://127.0.0.1:4173` (or the port in `E2E_PORT`).
- **`npm start`** builds the app and serves that build at `http://localhost:4300`, with `--strictPort`, so it fails rather than move to another port.
  This is where Daniel practises.
  The browser keeps storage per origin, so Daniel's history lives at that one address, apart from the dev server's and the tests'.
  The microphone works there because `localhost` is a secure context.
  A phone reaching the PC by a plain `http://` address on the local network is not one, so the phone check (ticket 23) waits for the deploy.

## What both servers send

`build/headers.ts` holds the headers, and its plugin runs before the model handler and Vite's own file handlers on both servers.

| Path below the base                                                  | `Cache-Control`                       | Why                                                             |
| -------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------- |
| `models/`                                                            | `public, max-age=31536000, immutable` | A model directory's version changes when any of its files does. |
| `ort/<version>/`                                                     | `public, max-age=31536000, immutable` | ONNX Runtime's release names its directory.                     |
| `assets/`                                                            | `public, max-age=31536000, immutable` | Vite names each built file by a hash of its content.            |
| Every other path, `index.html` and the single-page fallback included | `no-cache`                            | The page must be asked for again, so it names the newest files. |

- `vite preview` sends the Content Security Policy as a header on every response: the directives in `build/content-security-policy.ts` plus `frame-ancestors 'none'`, which a `<meta>` cannot carry.
  The built page keeps its `<meta>` policy too.
- Both servers send `X-Content-Type-Options: nosniff` on every response.
  The dev server sends no policy, since its client and Foldkit's development tools need more than it allows.
- Neither server sends a cross-origin isolation header (`Cross-Origin-Opener-Policy`, `Cross-Origin-Embedder-Policy`), and nothing needs one: ONNX Runtime runs on one thread.
- `vite preview` answers any route of the app with `index.html`, the single-page fallback.
  A path under `models/`, `ort/<version>/` or `assets/` that no file answers gets a `404` with `no-cache` instead, on both servers, so a missing file is never the page kept for a year.

`tests/build/serving.test.ts` reads these headers from both servers by HTTP, and `tests/e2e/model-serving.spec.ts` checks in Chromium that a second visit fetches SwiftF0 and Silero VAD from the browser's cache.

## Model files

`models.json` lists every model: its `id`, `name`, `licence` and `source` page, and one or more `files`.
Each file has a relative `path`, which may name a folder (`onnx/decoder_model_merged_int8.onnx`, as Transformers.js lays a model out), its `url` at a pinned revision (the URL must name a 40-character commit, never a branch), its size in `bytes` and its `sha256`.

Every file of a model is served under its model directory, `/models/<id>/<version>/<path>`.
`<version>` is the first 16 hex digits of the SHA-256 of the model's `<path> <sha256>` lines, each ended by a newline, sorted.
Changing, adding or removing any file moves the whole model to a new directory, so a browser never mixes files from two versions, and each file can be kept for good.

`virtual:intone/models` gives the app `modelDirectories`, each model's directory URL ending in `/`, and `modelUrls`, the file's URL for each model of one file.
Nothing in `src/` names a model path.

### Adding or updating a model

1. Find the file at a pinned revision: on Hugging Face, `https://huggingface.co/<repo>/resolve/<commit>/<path>`.
2. Download it once and measure its size and SHA-256 (`sha256sum`); for a large file, Hugging Face's tree listing, `/api/models/<repo>/tree/<commit>/<folder>`, gives both to compare.
   Add the model, or its new file, to `models.json` with them.
3. Run `npm run fetch:models`, which downloads every listed file into `.cache/models/` and checks it.
4. Run `npm run generate`, which rewrites `NOTICES.md` and `src/virtual-modules.d.ts` from the list.

What the build checks:

- `models.json` decodes: ids are unique, each path is relative and has no `..`, a model's paths are unique, each URL names a commit, each size is a whole number of bytes, each SHA-256 is 64 hex digits.
- Every file is downloaded, or found in the cache, before bundling, and a size or SHA-256 that differs from the list fails the build, naming the model and the file.
  A file that fails the check is never left in the cache.
- The files are copied into `dist/` after the bundle is written, so no model byte passes through the bundler.
- No model file is committed (`tests/build/asset-paths.test.ts`), and GitHub refuses files over 100 MiB anyway.

The cache, `.cache/models/<sha256>/<file name>`, is content-addressed, so a file is fetched once, whichever model directory serves it; CI keeps it between runs.

### One handler for model files

`build/model-requests.ts` answers every request for a model file, in the dev server from the cache and in `vite preview` from `dist/`:

- the content type by extension: `.json` as `application/json`, `.txt` as `text/plain; charset=utf-8`, and any other, `.onnx` included, as `application/octet-stream`;
- `Content-Length` and `Accept-Ranges: bytes`;
- one byte range with `206` and `Content-Range`, a range that starts past the end with `416`, and a header that is not one well-formed range ignored, sending the whole file;
- a path `models.json` does not list passed on to the next handler.

Left to itself, `vite preview` sends `.onnx` files with no content type and with `Cache-Control: no-cache`, and the dev server's earlier handler sent no `Cache-Control` and ignored `Range`.

### The largest file

`whisper-small`'s merged decoder, `onnx/decoder_model_merged_int8.onnx`, is 156,795,750 bytes (149.5 MiB), int8, the dtype T226's speech-recognition spike ran.
It comes from `onnx-community/whisper-small_timestamped` at revision `65caa70f294b46e1c33ff820aae6b16d048ab818`, the export that gives word timestamps (`docs/transcription.md`); until ticket 16 it came from `onnx-community/whisper-small`, 156,750,845 bytes.
On 2026-11-12 both local servers served that earlier file whole: `200`, `Content-Type: application/octet-stream`, `Content-Length: 156750845`, the listed SHA-256 byte for byte, `Cache-Control: public, max-age=31536000, immutable`, a range from byte 156,000,000 as `206`, and a range from its size as `416`.
Plain `vite preview`, with none of the project's plugins, sends it whole too, and answers the same two ranges, but with an empty `Content-Type` and `Cache-Control: no-cache`.
`tests/build/serving.test.ts` checks this on every run, on the file `models.json` lists now.

### Interrupted downloads

Both servers answer range requests, but the app does not resume an interrupted download: on localhost a download does not break.
A phone's connection might, so the deploy must measure whether Whisper's downloads need resuming, and the loader can add it then, since the servers already answer ranges.

## The deploy, shelved

When Daniel lifts the shelf, a later task picks this list up.
Nothing in this repository contacts Vercel today.

- Daniel imports `chanjdaniel/intone_app` into Vercel, with `dev` as the production branch.
  Every push and pull request then gets a build through the GitHub integration, previews behind Vercel's Standard Protection (Daniel's Vercel login), and production public at its `.vercel.app` address.
- A `vercel.json` sets the build command, `dist` as the output, the single-page fallback to `index.html` (never under `/models/`, `/ort/` or `/assets/`), and the headers and caching of "What both servers send": the Content Security Policy with `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, and immutable `/models/`, `/ort/` and `/assets/`.
  It is written from the table in `build/headers.ts` and checked against it by a test.
  Vercel's Node version matches `.nvmrc`.
- A preview proves `whisper-small`'s 149.5 MiB decoder is served whole, as "The largest file" says the local servers do.
  If Vercel refuses it, the models move to a public Vercel Blob store, the Content Security Policy names its one host, and the model URL map resolves to it.
- Measure whether Vercel answers a range request with `206`, and whether the loader should resume an interrupted download over a phone's connection.
- Find the Vercel team and plan, its included transfer, whether that allowance is shared with Conventioner, and the transfer cost of 100 first downloads of `whisper-base`.
- CI keeps running end to end against the local production build with no Vercel secret.
  A smoke test of a preview runs only if Daniel adds a Protection Bypass for Automation secret, which no session reads.
- No Vercel token lives in GitHub or in any session, no session runs a command against Daniel's Vercel account, and the dashboard steps (import, promote, roll back, Blob) are Daniel's.
- Then ticket 23, the phone check, runs on the production address.
