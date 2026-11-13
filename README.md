# Intone

Intone is a browser app for practising Japanese pitch accent by copying native lines.
You hear a line, record your copy, and see your pitch drawn over the native speaker's.
Everything runs on your device, with no server: no audio, pitch curve or text leaves the browser.

[Slideshow presentation of background, rationale, and design](https://docs.google.com/presentation/d/1wyh0-Kk8HNgJSuamyvwcEfg6f-_GLjgRmvhXkg8kFTo/edit?usp=sharing)

## Running it

Intone needs Node.js 24.22.1, the version in `.nvmrc` (`nvm use` picks it up).

```bash
npm ci
npm start
```

`npm start` builds the app and serves that build, the local production build, at http://localhost:4300; open it in a desktop browser to practise.
The microphone works there because `localhost` is a secure context.
The browser keeps your history per address, so the history at `localhost:4300` is yours alone: the dev server's `localhost:5173` and the tests' `127.0.0.1` keep their own.
Restart `npm start` after pulling a change to practise on it.

`npm run dev` serves the app at http://localhost:5173 while you work on it.
`npm run build` writes the production build to `dist/`, and `npm run preview` serves that build.
[`docs/deploying.md`](docs/deploying.md) says how both servers serve the app and its models, and what the deploy, shelved for now, will take.

The checks CI runs:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run check:effect
npm run generate:check
npm test
npm run build
npm run check:budget
npx playwright install chromium
npm run test:e2e
```

`npm test` runs the unit, Story and Scene tests in Vitest.
`npm run test:e2e` builds the app and runs the Playwright tests against that build in headless Chromium, with Chromium's fake microphone playing the synthetic voices in `fixtures/synthetic/` ([`docs/fake-microphone.md`](docs/fake-microphone.md)).
The first build fetches the model files listed in `models.json`, about 314 MB, most of it the two Whisper models, into `.cache/models/`, so it needs the network.
`npm run dev` also serves a component library at http://localhost:5173/dev, which production builds leave out.

The app is built with [Foldkit](https://foldkit.dev) on [Effect](https://effect.website).
[`AGENTS.md`](AGENTS.md) says how the code is laid out and checked, [`CONTEXT.md`](CONTEXT.md) what its words mean, and [`docs/upgrading.md`](docs/upgrading.md) how Foldkit and Effect are upgraded.
`repos/foldkit/` holds Foldkit's own repository at the installed release, vendored as reading only.

## The 2023 iOS project

The original Xcode project, its test targets and Swift files are kept on the [`legacy`](https://github.com/chanjdaniel/intone_app/tree/legacy) branch.

## Licence

All rights reserved; see [LICENSE](LICENSE).
The third-party packages and models the app ships, and their licences, are in [NOTICES.md](NOTICES.md), and the recordings it brings and their credits in [CREDITS.md](CREDITS.md).

## Thanks

Special thanks to Professor Suzuki Michiko of the UBC Department of Asian Studies for supervising this project.
