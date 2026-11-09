#!/usr/bin/env bash
# Vendors Foldkit's repository at repos/foldkit/ as reading only, pinned to
# the release tag of the installed `foldkit` package, and re-pins it after an
# upgrade (docs/upgrading.md).
#
# Run it from a clean tree after `npm ci` (or the upgrade's `npm install`):
#
#   scripts/vendor-foldkit.sh
#
# It fetches the release tag, adds the subtree with `git subtree add --squash`
# the first time and `git subtree merge --squash` after (what `git subtree
# pull` does, skipped when the subtree is already at the release), then
# drops two things from the subtree:
#
# - the files that would load as instructions in an agent session: every
#   CLAUDE.md, .claude/, .claude-plugin/ and .agents/ (Foldkit maintainers'
#   own guide, settings and skills);
# - Foldkit's own vendored repos/, whose Effect source is at the version
#   Foldkit develops on, not the one this project installs; the project
#   reads node_modules/effect/ instead.
#
# It keeps the rest (AGENTS.md, skills/, examples/, packages/foldkit/src/
# and so on) as reading, replaces FOLDKIT.md whole with the release's
# template, and commits. Run again at the same release, it changes nothing.
#
# FOLDKIT_REPOSITORY overrides where Foldkit is fetched from; the script's
# test points it at a local stand-in.

set -euo pipefail

repository="${FOLDKIT_REPOSITORY:-https://github.com/foldkit/foldkit.git}"
prefix=repos/foldkit
template="$prefix/packages/create-foldkit-app/templates/base/FOLDKIT.md"
# A path the script drops from the subtree, as above.
dropped="^$prefix/repos/|(^|/)(CLAUDE\\.md|\\.claude|\\.claude-plugin|\\.agents)(/|\$)"

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

if [ ! -d "$prefix" ]; then
  git subtree add --prefix="$prefix" "$release" --squash \
    --message "build: vendor Foldkit at repos/foldkit, pinned to $tag"
else
  # The release the subtree was last squashed from, from git subtree's own
  # trailer on that commit.
  pinned="$(git log -1 --format=%B --grep="^git-subtree-dir: $prefix/*\$" |
    sed -n 's/^git-subtree-split: //p')"
  if [ "$pinned" != "$release" ] &&
    ! git subtree merge --prefix="$prefix" "$release" --squash \
      --message "build: re-pin repos/foldkit to $tag"; then
    # A dropped path changed upstream after this project dropped it: keep it
    # dropped. Any other conflict is a real one, left for a person.
    conflicts="$(git diff --name-only --diff-filter=U)"
    [ -n "$conflicts" ] || fail "git subtree merge of $tag failed"
    if grep -Ev "$dropped" <<<"$conflicts" >/dev/null; then
      fail "the merge of $tag conflicts outside the dropped files; resolve it and commit, then run this script again"
    fi
    xargs git rm --quiet -r -- <<<"$conflicts"
    while IFS= read -r path; do
      printf 'vendor-foldkit: kept dropped: %s\n' "$path"
    done <<<"$conflicts"
    git commit --quiet --no-edit
  fi
fi

git ls-files -z -- "$prefix" |
  { grep -zE "$dropped" || true; } |
  xargs -0 --no-run-if-empty git rm --quiet -r --
[ -f "$template" ] || fail "$tag has no FOLDKIT.md template at $template"
cp "$template" FOLDKIT.md
git add FOLDKIT.md

if ! git diff --cached --quiet; then
  git commit --quiet --message "build: keep repos/foldkit at $tag as reading only" \
    --message "Drops the subtree's CLAUDE.md, .claude/, .claude-plugin/ and .agents/, which would load as instructions in an agent session, and Foldkit's own vendored repos/, and replaces FOLDKIT.md with $tag's template."
fi

printf 'vendor-foldkit: repos/foldkit is at %s\n' "$tag"
