[CmdletBinding()]
param(
  [switch]$Package,
  [switch]$SkipNpmBuild,
  [switch]$SkipBackendTests
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$DesktopDir = Join-Path $Root "apps\desktop"
$BackendPackageDir = Join-Path $Root "apps\backend\kubedeck_backend"
$BackendTestsDir = Join-Path $Root "apps\backend\tests"
$ReleaseDir = Join-Path $DesktopDir "release"

function Write-Section {
  param([string]$Title)
  Write-Host ""
  Write-Host "==> $Title" -ForegroundColor Cyan
}

function Invoke-Native {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
  }
}

function Assert-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Command '$Name' was not found in PATH."
  }
}

Set-Location $Root

Write-Section "Checking project root"
Write-Host "Project: $Root"

if (-not (Test-Path -LiteralPath (Join-Path $Root "package.json"))) {
  throw "package.json not found. Run this script from the KubeDeck project layout."
}

Write-Section "Checking portable kubectl unbundling"
$BuilderPath = Join-Path $DesktopDir "electron-builder.yml"
$MainPath = Join-Path $DesktopDir "src\main\main.ts"

$Builder = Get-Content -LiteralPath $BuilderPath -Raw
$Main = Get-Content -LiteralPath $MainPath -Raw

if ($Builder -match "(?im)^\s*-\s*from:\s*\.\.\/\.\.\/kubectl\.exe\s*$" -or $Builder -match "(?im)^\s*to:\s*bin\/kubectl\.exe\s*$") {
  throw "electron-builder.yml still bundles root-level kubectl.exe."
}

if ($Main -match "packagedKubectl" -or $Main -match "KUBEDECK_KUBECTL_PATH" -or $Main -match "resourcesPath.*bin.*kubectl") {
  throw "Electron main process still appears to inject a packaged kubectl path."
}

Write-Host "OK: portable config uses user-provided kubectl only." -ForegroundColor Green

if (-not $SkipBackendTests) {
  Write-Section "Running backend compileall"
  Assert-Command "py"
  Invoke-Native py -3 -m compileall "$BackendPackageDir"

  Write-Section "Running backend tests"
  Invoke-Native py -3 -m pytest "$BackendTestsDir"
} else {
  Write-Section "Skipping backend tests"
}

if (-not $SkipNpmBuild) {
  Write-Section "Running desktop TypeScript/Vite build"
  Assert-Command "npm.cmd"
  Invoke-Native npm.cmd run build
} else {
  Write-Section "Skipping npm build"
}

if ($Package) {
  Write-Section "Building portable package"
  $PackageScript = Join-Path $Root "scripts\package-windows.ps1"
  Invoke-Native powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PackageScript"

  Write-Section "Verifying release does not contain kubectl.exe"
  if (-not (Test-Path -LiteralPath $ReleaseDir)) {
    throw "Release directory not found after packaging: $ReleaseDir"
  }

  $KubectlFiles = Get-ChildItem -Path $ReleaseDir -Recurse -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ieq "kubectl.exe" -or $_.Name -ieq "kubectl.exe.sha256" }

  if ($KubectlFiles) {
    $KubectlFiles | Select-Object FullName, Length | Format-Table -AutoSize
    throw "Release output contains kubectl files."
  }

  Write-Host "OK: release output does not contain kubectl.exe or kubectl.exe.sha256." -ForegroundColor Green
}

Write-Section "Manual smoke checklist"
Write-Host "1. Start portable app."
Write-Host "2. Confirm kubectl path is resolved from Settings or PATH."
Write-Host "3. Import/open kubeconfig and select a cluster."
Write-Host "4. Open Pods, Deployments, Services, Events and Problems."
Write-Host "5. Open a Pod drawer and check YAML, Describe, Logs, Events and Related."
Write-Host "6. Open Settings -> Resource watch and confirm active watch status."
Write-Host "7. Trigger a pod change and confirm the active table refreshes automatically."
Write-Host "8. Run a safe bulk delete test in a test namespace and confirm the result panel appears."

Write-Host ""
Write-Host "Validation completed." -ForegroundColor Green

