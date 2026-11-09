# Intone

Intone is a browser app for practising Japanese pitch accent by copying native lines.
You hear a line, record your copy, and see your pitch drawn over the native speaker's.
Everything runs on your device, with no server: no audio, pitch curve or text leaves the browser.

[Slideshow presentation of background, rationale, and design](https://docs.google.com/presentation/d/1wyh0-Kk8HNgJSuamyvwcEfg6f-_GLjgRmvhXkg8kFTo/edit?usp=sharing)

## Running it

Intone needs Node.js 24.22.1, the version in `.nvmrc` (`nvm use` picks it up).

```bash
npm ci
npm run dev
```

`npm run dev` serves the app at http://localhost:5173.
`npm run build` writes the production build to `dist/`, and `npm run preview` serves that build.

The checks CI runs:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run check:effect
npm test
npx playwright install chromium
npm run test:e2e
```

`npm test` runs the unit, Story and Scene tests in Vitest.
`npm run test:e2e` builds the app and runs the Playwright tests against that build in headless Chromium.

The app is built with [Foldkit](https://foldkit.dev) on [Effect](https://effect.website).
[`AGENTS.md`](AGENTS.md) says how the code is laid out and checked, [`CONTEXT.md`](CONTEXT.md) what its words mean, and [`docs/upgrading.md`](docs/upgrading.md) how Foldkit and Effect are upgraded.
`repos/foldkit/` holds Foldkit's own repository at the installed release, vendored as reading only.

## The 2023 iOS project

The original Xcode project, its test targets and Swift files are kept on the [`legacy`](https://github.com/chanjdaniel/intone_app/tree/legacy) branch.

## Licence

All rights reserved; see [LICENSE](LICENSE).

## Thanks

Special thanks to Professor Suzuki Michiko of the UBC Department of Asian Studies for supervising this project.
