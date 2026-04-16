# Download yt-dlp + ffmpeg sidecars for a Tauri Windows target.
#
# Places binaries at apps/desktop/src-tauri/binaries/{name}-{target}.exe
# — the naming convention tauri.conf.json > bundle.externalBin expects.
#
# Usage:
#   scripts\fetch-sidecars.ps1
#   scripts\fetch-sidecars.ps1 -Target x86_64-pc-windows-msvc -Force
#
# SECURITY: Every downloaded archive/binary is verified against a pinned
# SHA256 hash before installation. Bumping $YtDlpVersion or $FfmpegVersion
# REQUIRES updating the matching *_Sha256 constant below — the script
# aborts on mismatch and leaves the old file in place.

param(
    [string]$Target = "x86_64-pc-windows-msvc",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

# ── Pinned versions + hashes ──────────────────────────────────────────────
# yt-dlp hash from upstream SHA2-256SUMS at
#   https://github.com/yt-dlp/yt-dlp/releases/download/$YtDlpVersion/SHA2-256SUMS
# ffmpeg hash from GyanD's per-release SHA256 sidecar asset at
#   https://github.com/GyanD/codexffmpeg/releases/tag/$FfmpegVersion
$YtDlpVersion = "2025.03.27"
$YtDlpWindowsSha256 = "183b1dd28d4a4566b4b5f82ff7697c7df074bdf14794bacade4e9e5dca41e5e1"

$FfmpegVersion = "8.1"
$FfmpegWindowsZipSha256 = "8748283d821613d930b0e7be685aaa9df4ca6f0ad4d0c42fd02622b3623463c6"

if ($Target -ne "x86_64-pc-windows-msvc") {
    Write-Error "Unsupported target for this script: $Target"
    exit 1
}

$Root    = Resolve-Path "$PSScriptRoot\.."
$OutDir  = Join-Path $Root "apps\desktop\src-tauri\binaries"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$YtDlpUrl = "https://github.com/yt-dlp/yt-dlp/releases/download/$YtDlpVersion/yt-dlp.exe"
$YtDlpOut = Join-Path $OutDir "yt-dlp-$Target.exe"

# Pinned versioned zip from GyanD/codexffmpeg, NOT the rolling
# ffmpeg-release-essentials.zip that tracks latest.
$FfmpegUrl = "https://github.com/GyanD/codexffmpeg/releases/download/$FfmpegVersion/ffmpeg-$FfmpegVersion-essentials_build.zip"
$FfmpegOut = Join-Path $OutDir "ffmpeg-$Target.exe"

function Verify-Sha256([string]$File, [string]$Expected, [string]$Label) {
    $got = (Get-FileHash -Algorithm SHA256 $File).Hash.ToLowerInvariant()
    $expectedLower = $Expected.ToLowerInvariant()
    if ($got -ne $expectedLower) {
        Write-Error @"
SHA256 mismatch for $Label
  expected: $expectedLower
  got:      $got
"@
        Remove-Item -Force $File -ErrorAction SilentlyContinue
        exit 1
    }
}

function Download-AndVerify([string]$Url, [string]$Out, [string]$Expected) {
    if ((Test-Path $Out) -and -not $Force) {
        Write-Host "✓ exists, skipping: $(Split-Path $Out -Leaf)"
        return
    }
    Write-Host "↓ $(Split-Path $Out -Leaf)"
    Invoke-WebRequest -Uri $Url -OutFile "$Out.tmp" -UseBasicParsing
    Verify-Sha256 "$Out.tmp" $Expected (Split-Path $Out -Leaf)
    Move-Item -Force "$Out.tmp" $Out
}

# ── yt-dlp: direct .exe download + verify ────────────────────────────────
Download-AndVerify $YtDlpUrl $YtDlpOut $YtDlpWindowsSha256

# ── ffmpeg: verify the zip, THEN extract the inner .exe ──────────────────
if ((Test-Path $FfmpegOut) -and -not $Force) {
    Write-Host "✓ exists, skipping: $(Split-Path $FfmpegOut -Leaf)"
} else {
    $Tmp = New-Item -ItemType Directory -Force -Path (Join-Path $env:RUNNER_TEMP "knoyoo-ffmpeg-$(Get-Random)") `
           -ErrorAction SilentlyContinue
    if (-not $Tmp) { $Tmp = New-Item -ItemType Directory -Force -Path (Join-Path $env:TEMP "knoyoo-ffmpeg-$(Get-Random)") }
    try {
        Write-Host "↓ $(Split-Path $FfmpegOut -Leaf) (via zip)"
        $ZipPath = Join-Path $Tmp "ffmpeg.zip"
        Invoke-WebRequest -Uri $FfmpegUrl -OutFile $ZipPath -UseBasicParsing
        Verify-Sha256 $ZipPath $FfmpegWindowsZipSha256 "ffmpeg-$FfmpegVersion-essentials_build.zip"
        Expand-Archive -Force -Path $ZipPath -DestinationPath (Join-Path $Tmp "extract")
        # gyan.dev layout: ffmpeg-<version>-essentials_build/bin/ffmpeg.exe
        $Candidate = Get-ChildItem -Recurse -Path (Join-Path $Tmp "extract") -Filter "ffmpeg.exe" |
                     Select-Object -First 1
        if (-not $Candidate) { Write-Error "ffmpeg.exe not found in archive"; exit 1 }
        Move-Item -Force $Candidate.FullName $FfmpegOut
    } finally {
        Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
    }
}

Write-Host "Sidecars ready in ${OutDir}:"
Get-ChildItem $OutDir | Format-Table Name, Length
