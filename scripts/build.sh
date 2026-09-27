#!/usr/bin/env bash
# Kicsomagolt (unpacked) bővítmény build Chrome-ra és Firefoxra.
# Használat: scripts/build.sh chrome|firefox|all
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

build_target() {
  local target="$1"
  local out="dist-${target}"

  rm -rf "$out"
  mkdir -p "$out"

  cp -R icons "$out/icons"
  cp -R src "$out/src"

  # Fejlesztői/dokumentációs fájlok ne kerüljenek a buildbe.
  find "$out" -name "*.map" -delete 2>/dev/null || true

  if [ "$target" = "chrome" ]; then
    # Chrome figyelmeztetést ír a browser_specific_settings kulcsra, ezért
    # a Chrome buildből kivesszük.
    jq 'del(.browser_specific_settings)' manifest.json > "$out/manifest.json"
  elif [ "$target" = "firefox" ]; then
    # Firefoxnak kell a gecko id + strict_min_version, ez marad.
    cp manifest.json "$out/manifest.json"
  else
    echo "Ismeretlen build cél: $target (chrome | firefox | all)" >&2
    exit 1
  fi

  echo "OK: $out"
}

case "${1:-all}" in
  chrome) build_target chrome ;;
  firefox) build_target firefox ;;
  all)
    build_target chrome
    build_target firefox
    ;;
  *)
    echo "Használat: $0 chrome|firefox|all" >&2
    exit 1
    ;;
esac
