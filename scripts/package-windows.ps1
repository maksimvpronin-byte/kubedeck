$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$DesktopDir = Join-Path $Root "apps\desktop"
$BackendDir = Join-Path $Root "apps\backend"
$BackendEntry = Join-Path $BackendDir "kubedeck_backend\main.py"
$BackendDist = Join-Path $DesktopDir "build\backend"
$BackendOnedirDist = Join-Path $Root "build\backend-onedir"
$BackendOnedirCollect = Join-Path $BackendOnedirDist "KubeDeck Backend"
$PyInstallerWork = Join-Path $Root "build\pyinstaller"
$ReleaseDir = Join-Path $DesktopDir "release"
$BackendExe = Join-Path $BackendDist "KubeDeck Backend.exe"
$BuildVenvDir = Join-Path $Root ".build-venv"
$BuildPythonExe = Join-Path $BuildVenvDir "Scripts\python.exe"
$RequirementsFile = Join-Path $BackendDir "requirements.lock.txt"
if (-not (Test-Path $RequirementsFile)) {
  $RequirementsFile = Join-Path $BackendDir "requirements.txt"
}

function Run-Step {
  param(
    [string]$Title,
    [scriptblock]$Command
  )
  Write-Host ""
  Write-Host "==> $Title" -ForegroundColor Cyan
  & $Command
}

function Assert-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Command '$Name' was not found in PATH."
  }
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

function Ensure-BuildPythonVenv {
  if (-not (Test-Path $BuildPythonExe)) {
    Write-Host "Creating isolated build Python venv: $BuildVenvDir"
    if (Test-Path $BuildVenvDir) {
      Remove-Item -LiteralPath $BuildVenvDir -Recurse -Force
    }
    Invoke-Native py -3 -m venv "$BuildVenvDir"
  }

  if (-not (Test-Path $BuildPythonExe)) {
    throw "Build Python executable was not created: $BuildPythonExe"
  }

  Invoke-Native $BuildPythonExe -m pip install --disable-pip-version-check --upgrade pip
}

function Stop-KubeDeckProcesses {
  $self = $PID
  try {
    Get-CimInstance Win32_Process |
      Where-Object {
        $_.ProcessId -ne $self -and
        (
          $_.CommandLine -like "*$Root*" -or
          $_.CommandLine -like "*KubeDeck-Portable*" -or
          $_.CommandLine -like "*kubedeck-backend*" -or
          $_.CommandLine -like "*KubeDeck Backend*"
        ) -and
        ($_.Name -in @("KubeDeck.exe", "electron.exe", "kubedeck-backend.exe", "KubeDeck Backend.exe", "node.exe", "py.exe", "python.exe"))
      } |
      ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
      }
  } catch {
    Write-Host "Could not inspect process command lines; falling back to process names. $($_.Exception.Message)" -ForegroundColor Yellow
    Get-Process -ErrorAction SilentlyContinue |
      Where-Object {
        $_.Id -ne $self -and
        ($_.ProcessName -in @("KubeDeck", "electron", "kubedeck-backend", "KubeDeck Backend") -or $_.ProcessName -like "KubeDeck-Portable*")
      } |
      ForEach-Object {
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
      }
  }
}

function Test-NpmDependenciesReady {
  $RequiredBins = @(
    (Join-Path $Root "node_modules\.bin\tsc.cmd"),
    (Join-Path $Root "node_modules\.bin\vite.cmd"),
    (Join-Path $Root "node_modules\.bin\electron-builder.cmd")
  )

  foreach ($RequiredBin in $RequiredBins) {
    if (-not (Test-Path $RequiredBin)) {
      Write-Host "Missing npm executable: $RequiredBin" -ForegroundColor Yellow
      return $false
    }
  }

  return $true
}

Set-Location $Root

Assert-Command "node"
Assert-Command "cmd"
Assert-Command "py"

Run-Step "Checking npm dependencies" {
  if (-not (Test-NpmDependenciesReady)) {
    throw "npm dependencies are incomplete. Run 'npm.cmd ci --prefer-offline --no-audit --no-fund' from project root first. Packaging will not repair node_modules automatically."
  }
  Write-Host "npm build tools OK." -ForegroundColor Green
}

Run-Step "Repairing electron-builder 7zip helper" {
  $Repair7zipScript = Join-Path $Root "scripts\repair-7zip-bin.ps1"
  if (-not (Test-Path $Repair7zipScript)) {
    throw "Missing repair script: $Repair7zipScript"
  }
  & $Repair7zipScript
}

Run-Step "Preparing isolated backend build Python venv" {
  Ensure-BuildPythonVenv
}

Run-Step "Installing backend Python dependencies into isolated venv" {
  Invoke-Native $BuildPythonExe -m pip install --disable-pip-version-check -r "$RequirementsFile"
}

Run-Step "Ensuring pinned PyInstaller is installed in isolated venv" {
  Invoke-Native $BuildPythonExe -m pip install --disable-pip-version-check pyinstaller==6.11.1
}

Run-Step "Cleaning packaging output" {
  Stop-KubeDeckProcesses
  Start-Sleep -Milliseconds 500
  if (Test-Path $BackendDist) {
    Remove-Item -LiteralPath $BackendDist -Recurse -Force
  }
  if (Test-Path $PyInstallerWork) {
    Remove-Item -LiteralPath $PyInstallerWork -Recurse -Force
  }
  if (Test-Path $BackendOnedirDist) {
    Remove-Item -LiteralPath $BackendOnedirDist -Recurse -Force
  }
  if (Test-Path $ReleaseDir) {
    Remove-Item -LiteralPath $ReleaseDir -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $BackendDist | Out-Null
  New-Item -ItemType Directory -Force -Path $PyInstallerWork | Out-Null
}

Run-Step "Building Electron renderer and main process" {
  Invoke-Native npm.cmd run build
}

Run-Step "Building backend executable" {
  Invoke-Native $BuildPythonExe -m PyInstaller `
    --noconfirm `
    --clean `
    --onedir `
    --name "KubeDeck Backend" `
    --distpath "$BackendOnedirDist" `
    --workpath "$PyInstallerWork" `
    --specpath "$PyInstallerWork" `
    --paths "$BackendDir" `
    --hidden-import uvicorn.logging `
    --hidden-import uvicorn.loops.auto `
    --hidden-import uvicorn.loops.asyncio `
    --hidden-import uvicorn.protocols.http.auto `
    --hidden-import uvicorn.protocols.http.h11_impl `
    --hidden-import uvicorn.protocols.websockets.auto `
    --hidden-import uvicorn.protocols.websockets.websockets_impl `
    --hidden-import uvicorn.lifespan.on `
    "$BackendEntry"

  Copy-Item -LiteralPath (Join-Path $BackendOnedirCollect "KubeDeck Backend.exe") -Destination $BackendExe -Force
  Copy-Item -LiteralPath (Join-Path $BackendOnedirCollect "_internal") -Destination (Join-Path $BackendDist "_internal") -Recurse -Force
}

if (-not (Test-Path $BackendExe)) {
  throw "Backend executable was not created: $BackendExe"
}

Write-Host "Portable package uses user-provided kubectl only: Settings path or PATH. No kubectl.exe is bundled or hash-checked." -ForegroundColor Green
Run-Step "Building Windows installer and portable exe" {
  Push-Location $DesktopDir
  try {
    $env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
    Invoke-Native npm.cmd run dist:win
  } finally {
    Pop-Location
  }
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "Build output:" -ForegroundColor Green
Write-Host "  $ReleaseDir"
Get-ChildItem -Path $ReleaseDir -Filter "*.exe" -ErrorAction SilentlyContinue | ForEach-Object {
  Write-Host "  $($_.FullName)"
}
