#!/usr/bin/env bash
set -euo pipefail

PI_ROOT="${PI_ROOT:-$(dirname "$(dirname "$(dirname "$(readlink -f "$(command -v pi)")")")")}"
if [[ ! -d "$PI_ROOT" ]]; then
  echo "Pi installation not found at $PI_ROOT" >&2
  exit 1
fi

mkdir -p node_modules/@earendil-works
created=()
link() {
  local target=$1 path=$2
  if [[ -e "$path" || -L "$path" ]]; then return; fi
  ln -s "$target" "$path"
  created+=("$path")
}
cleanup() {
  local path
  for path in "${created[@]}"; do rm -rf "$path"; done
  rmdir node_modules/@earendil-works node_modules 2>/dev/null || true
}
trap cleanup EXIT

link "$PI_ROOT" node_modules/@earendil-works/pi-coding-agent
link "$PI_ROOT/node_modules/@earendil-works/pi-tui" node_modules/@earendil-works/pi-tui

# Pi 0.85's unbundled public index references an experimental optional server
# package omitted from this installation. The loader supplies link-time stubs;
# modal-editor tests never execute that experimental API.
node --experimental-strip-types --experimental-loader ./test/pi-server-loader.mjs \
  --test test/modal-editor-core.test.ts test/modal-editor-integration.test.ts
