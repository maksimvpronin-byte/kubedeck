<#
.SYNOPSIS
  Repairs the 7zip-bin package used by electron-builder.

.DESCRIPTION
  electron-builder expects node_modules\7zip-bin\win\x64\7za.exe.
  On some Windows setups npm/Defender can leave the package directory incomplete.
  This script restores 7za.exe from the official npm package tarball and fails
  with a clear message if the binary is still missing.
#>

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Resolve-Path (Join-Path $scriptDir "..")
Set-Location $root

$sevenZipExe = Join-Path $root "node_modules\7zip-bin\win\x64\7za.exe"
$sevenZipDir = Join-Path $root "node_modules\7zip-bin"

Write-Host "7zip-bin expected file: $sevenZipExe"

if (Test-Path -LiteralPath $sevenZipExe) {
  Write-Host "7zip-bin is OK." -ForegroundColor Green
  exit 0
}

Write-Host "7zip-bin is incomplete. Repairing..." -ForegroundColor Yellow

# First try a normal npm install for the exact version electron-builder uses.
npm.cmd install 7zip-bin@5.2.0 --save-dev --include-workspace-root

if (Test-Path -LiteralPath $sevenZipExe) {
  Write-Host "7zip-bin repaired by npm install." -ForegroundColor Green
  exit 0
}

Write-Host "npm install did not restore 7za.exe. Trying npm pack fallback..." -ForegroundColor Yellow

$tempDir = Join-Path $env:TEMP ("kubedeck-7zip-bin-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

try {
  Push-Location $tempDir
  $tgzName = (& npm.cmd pack 7zip-bin@5.2.0 --silent | Select-Object -Last 1).Trim()
  if (-not $tgzName) {
    throw "npm pack did not return a tarball name."
  }

  $tgzPath = Join-Path $tempDir $tgzName
  if (-not (Test-Path -LiteralPath $tgzPath)) {
    throw "npm pack tarball was not created: $tgzPath"
  }

  tar -xzf $tgzPath -C $tempDir

  $packageDir = Join-Path $tempDir "package"
  if (-not (Test-Path -LiteralPath (Join-Path $packageDir "win\x64\7za.exe"))) {
    throw "The downloaded 7zip-bin package does not contain win\x64\7za.exe."
  }

  if (Test-Path -LiteralPath $sevenZipDir) {
    Remove-Item -LiteralPath $sevenZipDir -Recurse -Force
  }

  New-Item -ItemType Directory -Force -Path (Split-Path $sevenZipDir -Parent) | Out-Null
  Copy-Item -LiteralPath $packageDir -Destination $sevenZipDir -Recurse -Force
} finally {
  Pop-Location
  Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}

if (-not (Test-Path -LiteralPath $sevenZipExe)) {
  throw @"
7zip-bin repair failed: $sevenZipExe is still missing.
Most likely Windows Defender or antivirus quarantined 7za.exe.
Check Windows Security quarantine or add a temporary exclusion for the project folder:
  Add-MpPreference -ExclusionPath "$root"
Then run:
  powershell.exe -ExecutionPolicy Bypass -File .\scripts\repair-7zip-bin.ps1
"@
}

Unblock-File -LiteralPath $sevenZipExe -ErrorAction SilentlyContinue
Write-Host "7zip-bin repaired successfully: $sevenZipExe" -ForegroundColor Green
