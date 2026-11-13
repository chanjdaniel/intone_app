#!/usr/bin/env bash
# Sets up VOICEVOX CORE for `npm run fixtures:voices`, on Linux x64:
#
# - the Python binding, pinned by hash, in the git-ignored .venv/;
# - VOICEVOX's ONNX Runtime, the Open JTalk dictionary and the voice
#   models the fixtures use, through VOICEVOX's own downloader, pinned by
#   hash, into the git-ignored .cache/voicevox/.
#
# The downloader asks you to agree to the VOICEVOX ONNX Runtime terms and
# the VOICEVOX voice model terms before it downloads them. That answer is
# yours to give: this script never gives it for you, so run it in a
# terminal. fixtures/README.md summarises both terms and each voice's own.
#
# `npm run fixtures:voices-setup`. Running it again reuses what is there.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cache="$root/.cache/voicevox"
release="https://github.com/VOICEVOX/voicevox_core/releases/download/0.17.1"
downloader_sha256="4ba6dc22bfacab5dd1a7cc0dc074ca714d920526ce90813aec06dc86531ddd8f"

if [[ "$(uname -s)-$(uname -m)" != "Linux-x86_64" ]]; then
  echo "scripts/voicevox/setup.sh pins VOICEVOX's Linux x64 build only." >&2
  exit 1
fi

mkdir -p "$cache"

fetch() {
  local url="$1" file="$2" sha256="$3"
  if [[ ! -f "$file" ]] || ! echo "$sha256  $file" | sha256sum --check --status; then
    curl --fail --location --silent --show-error --output "$file.part" "$url"
    echo "$sha256  $file.part" | sha256sum --check --quiet
    mv "$file.part" "$file"
  fi
}

fetch "$release/download-linux-x64" "$cache/download-linux-x64" "$downloader_sha256"
chmod +x "$cache/download-linux-x64"

# The models the voices in tests/support/voice-fixture-set.ts live in.
# The downloader takes one glob, with no braces: `[0-49]` is 0 to 4 and 9.
models_pattern='[0-49].vvm'
models=(0 1 2 3 4 9)
missing=()
[[ -e "$cache/onnxruntime/lib/libvoicevox_onnxruntime.so.1.17.3" ]] || missing+=(onnxruntime)
[[ -d "$cache/dict/open_jtalk_dic_utf_8-1.11" ]] || missing+=(dict)
for model in "${models[@]}"; do
  if [[ ! -e "$cache/models/vvms/$model.vvm" ]]; then
    missing+=(models)
    break
  fi
done
if ((${#missing[@]} > 0)); then
  "$cache/download-linux-x64" \
    --only "${missing[@]}" \
    --onnxruntime-version 1.17.3 \
    --models-version 0.17.1 \
    --models-pattern "$models_pattern" \
    --output "$cache"
fi
for model in "${models[@]}"; do
  if [[ ! -e "$cache/models/vvms/$model.vvm" ]]; then
    echo "The downloader did not write models/vvms/$model.vvm." >&2
    exit 1
  fi
done

uv venv --quiet --allow-existing --python 3.13 "$root/.venv"
uv pip install --quiet --python "$root/.venv/bin/python" --require-hashes \
  --requirement "$root/scripts/voicevox/requirements.txt"

echo "VOICEVOX CORE is ready: npm run fixtures:voices"
