#!/usr/bin/env bash
# Vendors Foldkit's repository at repos/foldkit/ as reading only, pinned to
# the release tag of the installed `foldkit` package, and re-pins it after an
# upgrade (docs/upgrading.md).
#
# Run it from a clean tree after `npm ci` (or the upgrade's `npm install`):
#
#   scripts/vendor-foldkit.sh
#
# It fetches the release tag and adds it with `git subtree add --squash` the
# first time; after that it replaces repos/foldkit/ with the release's tree.
# Then it drops three things from the subtree:
#
# - the files that would load as instructions in an agent session: every
#   CLAUDE.md, .claude/, .claude-plugin/ and .agents/ (Foldkit maintainers'
#   own guide, settings and skills);
# - Foldkit's own vendored repos/, whose Effect source is at the version
#   Foldkit develops on, not the one this project installs; the project
#   reads node_modules/effect/ instead;
# - Foldkit's CI, deploy and secrets files: every .github/, vercel.json and
#   .env*, which never run here but would look like this project's own.
#
# It keeps the rest (AGENTS.md, skills/, examples/, packages/foldkit/src/
# and so on) as reading, replaces FOLDKIT.md whole with the release's
# template, and commits. Run again at the same release, it changes nothing.
#
# scripts/vendor-foldkit.pin names the release tag and the commit it named
# when it was vendored. The script records it on a release's first run and,
# at the same release, fails before changing anything when the tag names
# another commit now, so an upstream re-tag cannot vendor another tree
# unseen.
#
# FOLDKIT_REPOSITORY overrides where Foldkit is fetched from; the script's
# test points it at a local stand-in.

set -euo pipefail

repository="${FOLDKIT_REPOSITORY:-https://github.com/foldkit/foldkit.git}"
prefix=repos/foldkit
template="$prefix/packages/create-foldkit-app/templates/base/FOLDKIT.md"
pin=scripts/vendor-foldkit.pin
# A path the script drops from the subtree, as above.
dropped="^$prefix/repos/|(^|/)(CLAUDE\\.md|\\.claude|\\.claude-plugin|\\.agents|\\.github|vercel\\.json|\\.env[^/]*)(/|\$)"

fail() {
  printf 'vendor-foldkit: %s\n' "$1" >&2
  exit 1
}

cd "$(git rev-parse --show-toplevel)"

[ -f node_modules/foldkit/package.json ] ||
  fail "foldkit is not installed; run npm ci first"
version="$(node -p "require('./node_modules/foldkit/package.json').version")"
tag="foldkit@$version"

[ -z "$(git status --porcelain --untracked-files=no)" ] ||
  fail "the tree has uncommitted changes; commit or set them aside first"

git fetch --quiet --no-tags "$repository" "refs/tags/$tag"
release="$(git rev-parse 'FETCH_HEAD^{commit}')"

if [ -f "$pin" ]; then
  read -r pinned_tag pinned_commit <"$pin"
  if [ "$pinned_tag" = "$tag" ] && [ "$pinned_commit" != "$release" ]; then
    fail "$tag names $release now, not $pinned_commit as $pin records; check the release upstream before changing the pin"
  fi
fi

if [ ! -d "$prefix" ]; then
  git subtree add --prefix="$prefix" "$release" --squash \
    --message "build: vendor Foldkit at repos/foldkit, pinned to $tag"
  subject="build: keep repos/foldkit at $tag as reading only"
else
  # Re-pin by replacing the directory with the release's tree. For a copy
  # that is only read, that is the tree `git subtree merge --squash` would
  # give, with no conflict to resolve, and it needs none of git subtree's
  # history, which a squash or rebase merge of a pull request flattens.
  git rm -r --quiet -- "$prefix"
  git read-tree --prefix="$prefix/" -u "$release"
  subject="build: re-pin repos/foldkit to $tag"
fi

# Written after git subtree add, which refuses a tree with staged changes.
mkdir -p "$(dirname "$pin")"
printf '%s %s\n' "$tag" "$release" >"$pin"
git add "$pin"

git ls-files -z -- "$prefix" |
  { grep -zE "$dropped" || true; } |
  xargs -0 --no-run-if-empty git rm --quiet -r -f --

[ -f "$template" ] || fail "$tag has no FOLDKIT.md template at $template"
cp "$template" FOLDKIT.md
git add FOLDKIT.md

if ! git diff --cached --quiet; then
  git commit --quiet --message "$subject" \
    --message "Foldkit commit $release, pinned in $pin. Drops the subtree's CLAUDE.md, .claude/, .claude-plugin/ and .agents/, which would load as instructions in an agent session, Foldkit's own vendored repos/, and its .github/, vercel.json and .env* files, and replaces FOLDKIT.md with $tag's template."
fi

printf 'vendor-foldkit: repos/foldkit is at %s\n' "$tag"
