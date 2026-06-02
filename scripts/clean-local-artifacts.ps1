<#
.SYNOPSIS
  Cleans local KubeDeck development artifacts from the repository root.

.DESCRIPTION
  Removes patch note files, patch archives, review archives, accidental extracted patch folders,
  project-tree.txt, and optional generated build/release folders.

  By default it does NOT remove node_modules to keep local development fast.
  Use -DeleteNodeModules when you want a fully clean dependency reinstall.

.EXAMPLE
  powershell.exe -ExecutionPolicy Bypass -File .\scripts\clean-local-artifacts.ps1

.EXAMPLE
  powershell.exe -ExecutionPolicy Bypass -File .\scripts\clean-local-artifacts.ps1 -WhatIf

.EXAMPLE
  powershell.exe -ExecutionPolicy Bypass -File .\scripts\clean-local-artifacts.ps1 -DeleteBuildOutputs -DeleteNodeModules
#>

[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [switch]$DeleteBuildOutputs,
  [switch]$DeleteNodeModules
)

$ErrorActionPreference = "Stop"

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Resolve-Path (Join-Path $scriptPath "..")

Write-Host "KubeDeck cleanup root: $root"

function Remove-PathSafe {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (Test-Path -LiteralPath $Path) {
    if ($PSCmdlet.ShouldProcess($Path, "Remove")) {
      Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
      Write-Host "Removed: $Path"
    }
  }
}

function Remove-RootFilesByPattern {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Pattern
  )

  Get-ChildItem -LiteralPath $root -File -Force -Filter $Pattern -ErrorAction SilentlyContinue | ForEach-Object {
    Remove-PathSafe -Path $_.FullName
  }
}

# Root-only patch/review artifacts created during iterative development.
Remove-RootFilesByPattern -Pattern "*_PATCH_NOTES.md"
Remove-RootFilesByPattern -Pattern "SECURITY_PATCH_NOTES.md"
Remove-RootFilesByPattern -Pattern "kubedeck-*-patch*.zip"
Remove-RootFilesByPattern -Pattern "kubedeck-*-hotfix*.zip"
Remove-RootFilesByPattern -Pattern "kubedeck-review*.zip"
Remove-RootFilesByPattern -Pattern "project-tree.txt"

# Accidental extracted patch directories in repository root.
Get-ChildItem -LiteralPath $root -Directory -Force -ErrorAction SilentlyContinue | Where-Object {
  $_.Name -like "kubedeck-*-patch" -or
  $_.Name -like "kubedeck-*-hotfix" -or
  $_.Name -like "kubedeck-review-*"
} | ForEach-Object {
  Remove-PathSafe -Path $_.FullName
}

# Optional generated outputs. Disabled by default because developers may want to keep latest packaged exe.
if ($DeleteBuildOutputs) {
  $generatedDirs = @(
    "build",
    "dist",
    "out",
    "coverage",
    "apps\desktop\build",
    "apps\desktop\dist",
    "apps\desktop\release",
    "apps\desktop\release-fixed",
    "apps\backend\build",
    "apps\backend\dist"
  )

  foreach ($relative in $generatedDirs) {
    Remove-PathSafe -Path (Join-Path $root $relative)
  }

  Get-ChildItem -LiteralPath $root -Directory -Force -Filter "__pycache__" -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
    Remove-PathSafe -Path $_.FullName
  }
}

if ($DeleteNodeModules) {
  Remove-PathSafe -Path (Join-Path $root "node_modules")
  Remove-PathSafe -Path (Join-Path $root "apps\desktop\node_modules")
  Remove-PathSafe -Path (Join-Path $root "packages\ui\node_modules")
  Remove-PathSafe -Path (Join-Path $root "packages\shared-types\node_modules")
}

Write-Host ""
Write-Host "Cleanup complete."
Write-Host "Recommended checks:"
Write-Host "  npm.cmd run typecheck"
Write-Host "  npm.cmd run build"
