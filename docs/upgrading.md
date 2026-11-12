# Upgrading Foldkit and Effect

Foldkit is pre-1.0 and breaks in minor releases, and Effect's minor releases wait on Foldkit, so upgrades are absorbed one at a time, on a schedule (about monthly) or for a fix the project needs.

## One upgrade, one pull request

1. Branch from `dev` and upgrade one thing: Foldkit to one release, or Effect within a range Foldkit already accepts.
2. Read Foldkit's changelog for every release between the installed one and the target, skipping none: `packages/foldkit/CHANGELOG.md` in Foldkit's repository, at the target's tag.
   Each "Minor Changes" entry may break the app; its before-and-after tables say what moved.
   Fix the app for each in the same pull request.
3. Pin the new versions exactly in `package.json` and run `npm install`, so the lockfile moves with them:
   - `foldkit`, `@foldkit/ui` and `@foldkit/devtools` at the target release;
   - `@foldkit/vite-plugin` and `@foldkit/oxlint-plugin`, which have their own version numbers, at the versions the matching `create-foldkit-app` release pairs with the target;
   - `effect`, `@effect/platform-browser` and `@effect/vitest` at one version, inside the peer range the target `foldkit` declares (today `~4.1.0`).
     Patch releases inside that range move freely; a new Effect minor waits until a Foldkit release takes it.
   - `@effect/tsgo` accepts only some oxlint and oxlint-tsgolint versions, and says which when it refuses one; move them together.
4. Commit, then re-pin the vendored Foldkit source with `npm run vendor:foldkit`.
   It needs a clean tree, replaces `repos/foldkit/` with the tree of the tag `foldkit@<installed version>`, drops the maintainer files and Foldkit's own `repos/` again, replaces `FOLDKIT.md` whole with the release's template, and commits.
   Read the new `FOLDKIT.md`'s diff: it is how Foldkit's conventions changed.
5. Update the version list in `AGENTS.md`, and run `npm run generate` so `NOTICES.md` names the new versions.
6. Run the whole suite, the end-to-end tests included:

   ```bash
   npm ci
   npm run format:check
   npm run lint
   npm run typecheck
   npm run check:effect
   npm run generate:check
   npm test
   npm run build
   npm run check:budget
   npm run test:e2e
   ```

   `npm run test:e2e` ends with the frame-rate test, `tests/e2e/frame-rate.spec.ts`: a 20 s take with the CPU slowed six times (four on CI) must hold 60 frames a second (`docs/latency.md`).
   It is the check every Foldkit upgrade must pass, since a slower runtime or renderer shows there first; run it alone with `npx playwright test --project timing --no-deps` after `npm run build`, which runs the live-curve timing test too.

7. Open the pull request with the changelog entries you read and what each changed in the app, the entry chunk's size before and after (`docs/bundle-budget.md`), and look at the change on the local production build (`npm start`, `http://localhost:4300`).

## Dependency bots

A dependency bot may open upgrade pull requests as a reminder, and none is ever merged automatically or merged as it stands: each becomes an upgrade done by the steps above, which the bot cannot do.

## When to leave Foldkit

No Foldkit release for three months, a break with no migration note that cannot be absorbed in a day, or its author stepping back.
Any of those is Daniel's decision; the folder line in `AGENTS.md` keeps the cost to a rewrite of `src/app`.
