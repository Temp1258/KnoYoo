#!/usr/bin/env bash
# Download yt-dlp + ffmpeg sidecars for a Tauri target triple.
#
# Places binaries at apps/desktop/src-tauri/binaries/{name}-{target}{ext},
# the naming convention tauri.conf.json > bundle.externalBin expects.
#
# Usage:
#   scripts/fetch-sidecars.sh               # auto-detect current host
#   scripts/fetch-sidecars.sh aarch64-apple-darwin
#
# Idempotent: already-downloaded binaries are skipped. Use --force to redo.

set -euo pipefail

# Pinned versions. Bump together with a manual test on both targets.
YT_DLP_VERSION="2025.03.27"

FORCE=0
TARGET="auto"
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    -*) echo "Unknown flag: $arg" >&2; exit 2 ;;
    *) TARGET="$arg" ;;
  esac
done

if [[ "$TARGET" == "auto" ]]; then
  case "$(uname -sm)" in
    "Darwin arm64")  TARGET="aarch64-apple-darwin" ;;
    "Darwin x86_64") TARGET="x86_64-apple-darwin" ;;
    *)
      echo "Unsupported host: $(uname -sm). Pass target triple explicitly." >&2
      echo "For Windows builds use scripts/fetch-sidecars.ps1 on a Windows runner." >&2
      exit 1
      ;;
  esac
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT/apps/desktop/src-tauri/binaries"
mkdir -p "$OUT_DIR"

# Per-target source URLs.
case "$TARGET" in
  aarch64-apple-darwin|x86_64-apple-darwin)
    # yt-dlp_macos is a universal2 standalone build.
    YT_DLP_URL="https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/yt-dlp_macos"
    YT_DLP_OUT="$OUT_DIR/yt-dlp-${TARGET}"
    FFMPEG_URL="https://evermeet.cx/ffmpeg/getrelease/zip"
    FFMPEG_OUT="$OUT_DIR/ffmpeg-${TARGET}"
    FFMPEG_ARCHIVE_PATH="ffmpeg"   # the only file inside the evermeet zip
    ;;
  *)
    echo "Unsupported target for this script: $TARGET" >&2
    exit 1
    ;;
esac

download_if_missing() {
  local url="$1" out="$2"
  if [[ -f "$out" && $FORCE -eq 0 ]]; then
    echo "✓ exists, skipping: $(basename "$out")"
    return
  fi
  echo "↓ $(basename "$out")"
  curl --fail --location --show-error --silent "$url" -o "$out.tmp"
  mv "$out.tmp" "$out"
  chmod +x "$out"
}

# yt-dlp: direct binary download.
download_if_missing "$YT_DLP_URL" "$YT_DLP_OUT"

# ffmpeg: comes as a zip with the binary at the root.
if [[ -f "$FFMPEG_OUT" && $FORCE -eq 0 ]]; then
  echo "✓ exists, skipping: $(basename "$FFMPEG_OUT")"
else
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  echo "↓ $(basename "$FFMPEG_OUT") (via zip)"
  curl --fail --location --show-error --silent "$FFMPEG_URL" -o "$tmp/ffmpeg.zip"
  unzip -q "$tmp/ffmpeg.zip" -d "$tmp/extract"
  mv "$tmp/extract/$FFMPEG_ARCHIVE_PATH" "$FFMPEG_OUT"
  chmod +x "$FFMPEG_OUT"
fi

echo "Sidecars ready in $OUT_DIR:"
ls -lh "$OUT_DIR"
