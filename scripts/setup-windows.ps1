#requires -Version 5.1
<#
.SYNOPSIS
  KubeDeck Windows bootstrap script.

.DESCRIPTION
  Checks and installs prerequisites, clones the project when requested,
  installs JavaScript/Python dependencies, and optionally builds the portable EXE.

.PARAMETER ProjectDir
  Directory where the repository should be cloned when -Clone is used.
  Default: %USERPROFILE%\KubeDeck

.PARAMETER Clone
  Clone the repository if the script is not already running from the project root.

.PARAMETER Build
  Build portable EXE after dependency installation.

.PARAMETER Dev
  Start development mode after setup.

.PARAMETER SkipPrerequisites
  Do not install/check system prerequisites through winget.
#>

[CmdletBinding()]
param(
  [string]$ProjectDir = (Join-Path $env:USERPROFILE "KubeDeck"),
  [switch]$Clone,
  [switch]$Build,
  [switch]$Dev,
  [switch]$SkipPrerequisites
)

$ErrorActionPreference = "Stop"
$RepoUrl = "https://github.com/maksimvpronin-byte/kubedeck.git"

function Write-Section {
  param([Parameter(Mandatory = $true)][string]$Title)
  Write-Host ""
  Write-Host "==> $Title" -ForegroundColor Cyan
}

function Test-Command {
  param([Parameter(Mandatory = $true)][string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-Native {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
  }
}

function Refresh-CurrentProcessPath {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machinePath;$userPath"
}

function Assert-Windows {
  if ($env:OS -ne "Windows_NT") {
    throw "This setup script is intended for Windows only."
  }
}

function Assert-Winget {
  if (-not (Test-Command "winget")) {
    throw @"
winget was not found.

Install or update Windows Package Manager / App Installer, then run this script again.
"@
  }
}

function Install-WingetPackage {
  param(
    [Parameter(Mandatory = $true)][string]$Id,
    [Parameter(Mandatory = $true)][string]$DisplayName
  )

  Write-Host "Installing/checking $DisplayName ($Id) ..."
  Invoke-Native winget install -e --id $Id --accept-source-agreements --accept-package-agreements
  Refresh-CurrentProcessPath
}

function Get-NodeMajor {
  if (-not (Test-Command "node")) {
    return 0
  }

  $version = (& node --version 2>$null).Trim()
  if ($version -match "^v?(\d+)\.") {
    return [int]$Matches[1]
  }

  return 0
}

function Get-PythonVersion {
  if (-not (Test-Command "py")) {
    return [version]"0.0"
  }

  $output = & py -3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $output) {
    return [version]"0.0"
  }

  return [version]($output.Trim())
}

function Ensure-Prerequisites {
  if ($SkipPrerequisites) {
    Write-Host "Skipping prerequisite installation by request." -ForegroundColor Yellow
    return
  }

  Assert-Winget

  if (-not (Test-Command "git")) {
    Install-WingetPackage -Id "Git.Git" -DisplayName "Git"
  } else {
    Write-Host "Git OK: $(& git --version)"
  }

  $nodeMajor = Get-NodeMajor
  if ($nodeMajor -lt 20) {
    Install-WingetPackage -Id "OpenJS.NodeJS.LTS" -DisplayName "Node.js LTS"
  } else {
    Write-Host "Node.js OK: $(& node --version)"
  }

  if (-not (Test-Command "npm.cmd")) {
    Refresh-CurrentProcessPath
  }

  if (-not (Test-Command "npm.cmd")) {
    throw "npm.cmd was not found. Close PowerShell, open it again and rerun this script."
  }

  Write-Host "npm OK: $(& npm.cmd --version)"

  $pythonVersion = Get-PythonVersion
  if ($pythonVersion -lt [version]"3.11") {
    Install-WingetPackage -Id "Python.Python.3.11" -DisplayName "Python 3.11"
  } else {
    Write-Host "Python OK: $(& py -3 --version)"
  }

  if (-not (Test-Command "kubectl")) {
    Install-WingetPackage -Id "Kubernetes.kubectl" -DisplayName "kubectl"
  } else {
    Write-Host "kubectl OK:"
    & kubectl version --client
  }

  Refresh-CurrentProcessPath
}

function Resolve-RepoRootFromScript {
  if ($PSScriptRoot) {
    $candidate = Resolve-Path (Join-Path $PSScriptRoot "..") -ErrorAction SilentlyContinue
    if ($candidate) {
      $candidatePath = $candidate.Path
      if (
        (Test-Path -LiteralPath (Join-Path $candidatePath "package.json")) -and
        (Test-Path -LiteralPath (Join-Path $candidatePath "apps\desktop")) -and
        (Test-Path -LiteralPath (Join-Path $candidatePath "apps\backend"))
      ) {
        return $candidatePath
      }
    }
  }

  $current = (Get-Location).Path
  if (
    (Test-Path -LiteralPath (Join-Path $current "package.json")) -and
    (Test-Path -LiteralPath (Join-Path $current "apps\desktop")) -and
    (Test-Path -LiteralPath (Join-Path $current "apps\backend"))
  ) {
    return $current
  }

  return $null
}

function Ensure-Repository {
  $existingRoot = Resolve-RepoRootFromScript
  if ($existingRoot) {
    Write-Host "Using existing project directory: $existingRoot"
    return $existingRoot
  }

  if (-not $Clone) {
    throw @"
Project root was not found.

Run this script from the KubeDeck repository root, or use:
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File <script> -Clone -Build
"@
  }

  if (Test-Path -LiteralPath (Join-Path $ProjectDir "package.json")) {
    Write-Host "Using existing project directory: $ProjectDir"
    return (Resolve-Path $ProjectDir).Path
  }

  $parent = Split-Path -Parent $ProjectDir
  if (-not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }

  if ((Test-Path -LiteralPath $ProjectDir) -and (Get-ChildItem -LiteralPath $ProjectDir -Force | Select-Object -First 1)) {
    throw "ProjectDir exists and is not empty, but does not look like KubeDeck: $ProjectDir"
  }

  Write-Section "Cloning KubeDeck"
  Invoke-Native git clone $RepoUrl $ProjectDir

  return (Resolve-Path $ProjectDir).Path
}

function Install-ProjectDependencies {
  param([Parameter(Mandatory = $true)][string]$Root)

  Set-Location $Root

  Write-Section "Installing npm dependencies"

  if (Test-Path -LiteralPath (Join-Path $Root "package-lock.json")) {
    Invoke-Native npm.cmd ci --no-audit --no-fund
  } else {
    Invoke-Native npm.cmd install --no-audit --no-fund
  }

  Write-Section "Installing Python backend dependencies"
  Invoke-Native py -3 -m pip install --user --disable-pip-version-check --upgrade pip
  Invoke-Native py -3 -m pip install --user --disable-pip-version-check -r ".\apps\backend\requirements.txt"

  Write-Section "Installing Python test dependency"
  Invoke-Native py -3 -m pip install --user --disable-pip-version-check pytest
}

function Build-Portable {
  param([Parameter(Mandatory = $true)][string]$Root)

  Set-Location $Root

  Write-Section "Building portable package"
  Invoke-Native powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\validate-1.0.5.ps1" -Package

  $releaseDir = Join-Path $Root "apps\desktop\release"

  Write-Host ""
  Write-Host "Build output:" -ForegroundColor Green

  $files = Get-ChildItem -LiteralPath $releaseDir -Filter "*.exe" -ErrorAction SilentlyContinue
  if (-not $files) {
    Write-Host "No .exe files found in $releaseDir" -ForegroundColor Yellow
    return
  }

  $files | ForEach-Object {
    Write-Host "  $($_.FullName)" -ForegroundColor Green
  }
}

function Build-DesktopOnly {
  param([Parameter(Mandatory = $true)][string]$Root)

  Set-Location $Root

  Write-Section "Running desktop build check"
  Invoke-Native npm.cmd run build
}

function Start-DevelopmentMode {
  param([Parameter(Mandatory = $true)][string]$Root)

  Set-Location $Root

  Write-Section "Starting development mode"
  Invoke-Native npm.cmd run dev
}

try {
  Write-Section "KubeDeck Windows setup"
  Assert-Windows

  Write-Section "Checking/installing prerequisites"
  Ensure-Prerequisites

  $root = Ensure-Repository

  Write-Section "Project root"
  Write-Host $root

  Install-ProjectDependencies -Root $root

  if ($Build) {
    Build-Portable -Root $root
  } elseif (-not $Dev) {
    Build-DesktopOnly -Root $root
  }

  if ($Dev) {
    Start-DevelopmentMode -Root $root
  }

  Write-Host ""
  Write-Host "KubeDeck setup completed successfully." -ForegroundColor Green
  Write-Host "Project directory: $root" -ForegroundColor Green
  Write-Host ""
  Write-Host "Useful commands:" -ForegroundColor Green
  Write-Host "  npm.cmd run dev" -ForegroundColor Green
  Write-Host "  powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate-1.0.5.ps1 -Package" -ForegroundColor Green
}
catch {
  Write-Host ""
  Write-Host "KubeDeck setup failed." -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 1
}
