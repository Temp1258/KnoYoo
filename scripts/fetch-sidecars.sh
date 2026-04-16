#!/usr/bin/env bash
# Download yt-dlp + ffmpeg sidecars for a Tauri target triple.
#
# Places binaries at apps/desktop/src-tauri/binaries/{name}-{target}{ext},
# the naming convention tauri.conf.json > bundle.externalBin expects.
#
# Usage:
#   scripts/fetch-sidecars.sh               # auto-detect current host
#   scripts/fetch-sidecars.sh aarch64-apple-darwin
#   scripts/fetch-sidecars.sh --force       # re-download and re-verify
#
# Idempotent: already-downloaded binaries are skipped. --force redownloads.
#
# SECURITY: Every downloaded archive/binary is verified against a pinned
# SHA256 hash before installation. Bumping YT_DLP_VERSION or FFMPEG_VERSION
# REQUIRES updating the matching *_SHA256 constant below — the script will
# refuse to install a mismatched file and leave the old one in place.

set -euo pipefail

# ── Pinned versions + hashes ────────────────────────────────────────────────
# yt-dlp hashes come straight from the upstream SHA2-256SUMS file at
#   https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/SHA2-256SUMS
# ffmpeg hashes are computed from the archives fetched from the pinned URLs;
# the URLs MUST point at a specific version, never at a "rolling latest".
YT_DLP_VERSION="2025.03.27"
YT_DLP_MACOS_SHA256="bd9bbe1568344f7b705de3ca1b6af34c6ca4b51ec30c5fa3341b8c31e8c3d3e0"

FFMPEG_VERSION="8.1"
FFMPEG_MACOS_ZIP_SHA256="d67db25908eff64b7d0eaa73784f0c55728d9e036a96931095fcf8e8968eefab"

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
    YT_DLP_SHA256="$YT_DLP_MACOS_SHA256"
    # Pinned version URL, NOT the rolling /getrelease/zip endpoint.
    FFMPEG_URL="https://evermeet.cx/ffmpeg/ffmpeg-${FFMPEG_VERSION}.zip"
    FFMPEG_OUT="$OUT_DIR/ffmpeg-${TARGET}"
    FFMPEG_ARCHIVE_PATH="ffmpeg"   # the only file inside the evermeet zip
    FFMPEG_ZIP_SHA256="$FFMPEG_MACOS_ZIP_SHA256"
    ;;
  *)
    echo "Unsupported target for this script: $TARGET" >&2
    exit 1
    ;;
esac

# ── Helpers ─────────────────────────────────────────────────────────────────

# Portable SHA256: `shasum -a 256` on macOS, `sha256sum` on Linux.
sha256_of() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  else
    shasum -a 256 "$file" | awk '{print $1}'
  fi
}

verify_sha256() {
  local file="$1" expected="$2" label="$3"
  local got
  got="$(sha256_of "$file")"
  if [[ "$got" != "$expected" ]]; then
    echo "✗ SHA256 mismatch for $label" >&2
    echo "  expected: $expected" >&2
    echo "  got:      $got" >&2
    rm -f "$file"
    exit 1
  fi
}

# Download to ${out}.tmp, verify, then rename. Never leaves a bad file at $out.
download_and_verify() {
  local url="$1" out="$2" expected="$3"
  if [[ -f "$out" && $FORCE -eq 0 ]]; then
    echo "✓ exists, skipping: $(basename "$out")"
    return
  fi
  echo "↓ $(basename "$out")"
  curl --fail --location --show-error --silent "$url" -o "$out.tmp"
  verify_sha256 "$out.tmp" "$expected" "$(basename "$out")"
  mv "$out.tmp" "$out"
  chmod +x "$out"
}

# ── yt-dlp: direct binary download + verify ─────────────────────────────────
download_and_verify "$YT_DLP_URL" "$YT_DLP_OUT" "$YT_DLP_SHA256"

# ── ffmpeg: verify the zip, THEN extract the inner binary ───────────────────
if [[ -f "$FFMPEG_OUT" && $FORCE -eq 0 ]]; then
  echo "✓ exists, skipping: $(basename "$FFMPEG_OUT")"
else
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  echo "↓ $(basename "$FFMPEG_OUT") (via zip)"
  curl --fail --location --show-error --silent "$FFMPEG_URL" -o "$tmp/ffmpeg.zip"
  verify_sha256 "$tmp/ffmpeg.zip" "$FFMPEG_ZIP_SHA256" "ffmpeg-${FFMPEG_VERSION}.zip"
  unzip -q "$tmp/ffmpeg.zip" -d "$tmp/extract"
  mv "$tmp/extract/$FFMPEG_ARCHIVE_PATH" "$FFMPEG_OUT"
  chmod +x "$FFMPEG_OUT"
fi

echo "Sidecars ready in $OUT_DIR:"
ls -lh "$OUT_DIR"
