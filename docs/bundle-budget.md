# The bundle budget

`bundle-budget.json` caps the gzip size of the entry chunk, the module script the built `index.html` loads.
CI builds the app and runs `npm run check:budget`, which fails above the cap, naming the chunk and by how much.
The script, `build/bundle-budget.ts`, gzips the chunk at level 9 and counts bytes; its reader is the one the tests use.

## How the cap was set

The cap is the entry chunk's size, measured through Vite's production build in a clean tree, rounded up to the next 10 kB (10,000 bytes), plus 20 kB.

| Measured at                    | Entry chunk, gzip | Cap       |
| ------------------------------ | ----------------- | --------- |
| `1e21a2b5` (ticket 03 of T242) | 100,804 B         | 130,000 B |

The base it was measured against, `3997c12d`, built the same way, gives 98,217 B: ticket 03 added 2,587 B with its routes, its not-found screen and the bridge to the dev library, whose own modules stay out of the build.

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
