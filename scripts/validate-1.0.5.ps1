param(
    [switch]$Build,
    [switch]$Package
)

$ErrorActionPreference = "Stop"

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$Arguments = @()
    )

    Write-Host "==> $FilePath $($Arguments -join ' ')"
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
    }
}

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $ProjectRoot

Write-Host "==> Validate KubeDeck 1.1.0 versions via node"
$VersionCheck = @'
const fs = require('fs');
const expected = '1.1.0';
function readJson(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}
function fail(message) {
  console.error(message);
  process.exit(1);
}
const rootPackage = readJson('package.json');
const desktopPackage = readJson('apps/desktop/package.json');
if (rootPackage.version !== expected) {
  fail('Root package version is ' + rootPackage.version + ', expected ' + expected);
}
if (desktopPackage.version !== expected) {
  fail('Desktop package version is ' + desktopPackage.version + ', expected ' + expected);
}
if (fs.existsSync('package-lock.json')) {
  const lock = readJson('package-lock.json');
  if (lock.version !== expected) {
    fail('package-lock version is ' + lock.version + ', expected ' + expected);
  }
  const packages = lock.packages || {};
  if (packages[''] && packages[''].version !== expected) {
    fail('package-lock root package entry is ' + packages[''].version + ', expected ' + expected);
  }
  if (packages['apps/desktop'] && packages['apps/desktop'].version !== expected) {
    fail('package-lock apps/desktop entry is ' + packages['apps/desktop'].version + ', expected ' + expected);
  }
}
console.log('Version check OK: ' + expected);
'@
Invoke-Checked -FilePath "node" -Arguments @("-e", $VersionCheck)

Write-Host "==> Backend syntax check"
Invoke-Checked -FilePath "py" -Arguments @("-3", "-m", "compileall", "-q", ".\apps\backend\kubedeck_backend")

if ($Build) {
    Write-Host "==> Build frontend/backend desktop bundle"
    Invoke-Checked -FilePath "npm" -Arguments @("run", "build")
}

if ($Package) {
    Write-Host "==> Package portable Windows build"
    if (Test-Path ".\scripts\package-windows.ps1") {
        Invoke-Checked -FilePath "powershell.exe" -Arguments @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ".\scripts\package-windows.ps1")
    } else {
        Invoke-Checked -FilePath "npm" -Arguments @("--workspace", "apps/desktop", "run", "dist:win")
    }
}

Write-Host "==> KubeDeck 1.1.0 validation completed"
