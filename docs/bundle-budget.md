# The bundle budget

`bundle-budget.json` caps the gzip size of what the page loads before it starts: the entry chunk, the module script the built `index.html` loads, and every chunk it imports statically, directly or through each other.
CI builds the app and runs `npm run check:budget`, which fails above the cap, naming the chunks and by how much.
The script, `build/bundle-budget.ts`, gzips each chunk on its own at level 9, as a host sends them, and adds the bytes; its reader is the one the tests use.

The bundler moves modules the entry shares with lazily loaded chunks into a chunk of their own when two or more lazy chunks share them, and the entry imports that chunk statically: measuring the entry chunk alone would then count less than the page loads.
Ticket 12 of T242 met this (a second lazy chunk moved 47 kB of Effect out of the entry), and the reader has counted the static imports since.

## How the cap was set

The cap is the entry chunk's size, measured through Vite's production build in a clean tree, rounded up to the next 10 kB (10,000 bytes), plus 20 kB.

| Measured at                    | Entry chunk, gzip | Cap       |
| ------------------------------ | ----------------- | --------- |
| `1e21a2b5` (ticket 03 of T242) | 100,804 B         | 130,000 B |
| ticket 12 of T242              | 153,950 B         | 180,000 B |

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
