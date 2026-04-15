# Download yt-dlp + ffmpeg sidecars for a Tauri Windows target.
#
# Places binaries at apps/desktop/src-tauri/binaries/{name}-{target}.exe
# — the naming convention tauri.conf.json > bundle.externalBin expects.
#
# Usage:
#   scripts\fetch-sidecars.ps1
#   scripts\fetch-sidecars.ps1 -Target x86_64-pc-windows-msvc -Force

param(
    [string]$Target = "x86_64-pc-windows-msvc",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

# Pinned versions. Bump together with the bash script.
$YtDlpVersion = "2025.03.27"

if ($Target -ne "x86_64-pc-windows-msvc") {
    Write-Error "Unsupported target for this script: $Target"
    exit 1
}

$Root    = Resolve-Path "$PSScriptRoot\.."
$OutDir  = Join-Path $Root "apps\desktop\src-tauri\binaries"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$YtDlpUrl = "https://github.com/yt-dlp/yt-dlp/releases/download/$YtDlpVersion/yt-dlp.exe"
$YtDlpOut = Join-Path $OutDir "yt-dlp-$Target.exe"

$FfmpegUrl = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
$FfmpegOut = Join-Path $OutDir "ffmpeg-$Target.exe"

function Download-IfMissing([string]$Url, [string]$Out) {
    if ((Test-Path $Out) -and -not $Force) {
        Write-Host "✓ exists, skipping: $(Split-Path $Out -Leaf)"
        return
    }
    Write-Host "↓ $(Split-Path $Out -Leaf)"
    Invoke-WebRequest -Uri $Url -OutFile "$Out.tmp" -UseBasicParsing
    Move-Item -Force "$Out.tmp" $Out
}

Download-IfMissing $YtDlpUrl $YtDlpOut

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

Write-Host "Sidecars ready in $OutDir:"
Get-ChildItem $OutDir | Format-Table Name, Length
