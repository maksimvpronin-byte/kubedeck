<#
KubeDeck Windows portable build script.

This is the single canonical portable builder for Windows.
It builds the Electron desktop app, packages the Python backend with PyInstaller,
and then runs electron-builder to produce the portable .exe.

Usage from repository root:
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-portable-windows.ps1

Optional first-run dependency install:
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-portable-windows.ps1 -InstallNpmDeps
#>

[CmdletBinding()]
param(
    [switch]$InstallNpmDeps,
    [switch]$SkipTypecheck
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([Parameter(Mandatory = $true)][string]$Title)
    Write-Host ""
    Write-Host "==> $Title" -ForegroundColor Cyan
}

function Write-Info {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host $Message -ForegroundColor Gray
}

function Write-Ok {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host $Message -ForegroundColor Green
}

function Assert-Command {
    param([Parameter(Mandatory = $true)][string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found in PATH."
    }
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

function Assert-ProjectRoot {
    param([Parameter(Mandatory = $true)][string]$Path)

    $RequiredPaths = @(
        "package.json",
        "apps\desktop\package.json",
        "apps\backend\kubedeck_backend\main.py",
        "scripts"
    )

    foreach ($RelativePath in $RequiredPaths) {
        $FullPath = Join-Path $Path $RelativePath
        if (-not (Test-Path $FullPath)) {
            throw "This script must be run from the KubeDeck repository root. Missing: $RelativePath"
        }
    }
}

function Read-JsonFile {
    param([Parameter(Mandatory = $true)][string]$Path)
    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Assert-VersionConsistency {
    param(
        [Parameter(Mandatory = $true)][string]$RootPackageJson,
        [Parameter(Mandatory = $true)][string]$DesktopPackageJson
    )

    $RootPkg = Read-JsonFile $RootPackageJson
    $DesktopPkg = Read-JsonFile $DesktopPackageJson

    if ($RootPkg.version -ne $DesktopPkg.version) {
        throw "Version mismatch: package.json=$($RootPkg.version), apps/desktop/package.json=$($DesktopPkg.version)"
    }

    Write-Ok "Project version: $($RootPkg.version)"
    return $RootPkg.version
}

function Test-NpmDependenciesReady {
    param([Parameter(Mandatory = $true)][string]$Root)

    $RequiredBins = @(
        "node_modules\.bin\tsc.cmd",
        "node_modules\.bin\vite.cmd",
        "node_modules\.bin\electron-builder.cmd"
    )

    foreach ($RelativeBin in $RequiredBins) {
        $RequiredBin = Join-Path $Root $RelativeBin
        if (-not (Test-Path $RequiredBin)) {
            Write-Host "Missing npm executable: $RequiredBin" -ForegroundColor Yellow
            return $false
        }
    }

    return $true
}

function Ensure-NpmDependencies {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [switch]$Install
    )

    if (Test-NpmDependenciesReady -Root $Root) {
        Write-Ok "npm build tools OK."
        return
    }

    if (-not $Install) {
        throw "npm dependencies are incomplete. Run 'npm.cmd ci --no-audit --no-fund' from the project root, or rerun this script with -InstallNpmDeps."
    }

    Write-Info "Installing npm dependencies because -InstallNpmDeps was specified."
    Invoke-Native npm.cmd ci --no-audit --no-fund

    if (-not (Test-NpmDependenciesReady -Root $Root)) {
        throw "npm dependencies are still incomplete after npm ci."
    }
}

function Ensure-BuildPythonVenv {
    param(
        [Parameter(Mandatory = $true)][string]$BuildVenvDir,
        [Parameter(Mandatory = $true)][string]$BuildPythonExe
    )

    if (-not (Test-Path $BuildPythonExe)) {
        Write-Info "Creating isolated build Python venv: $BuildVenvDir"
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
    param([Parameter(Mandatory = $true)][string]$Root)

    $SelfPid = $PID

    try {
        Get-CimInstance Win32_Process |
            Where-Object {
                $_.ProcessId -ne $SelfPid -and
                ($_.Name -in @("KubeDeck.exe", "electron.exe", "kubedeck-backend.exe", "KubeDeck Backend.exe", "node.exe", "py.exe", "python.exe")) -and
                ($_.CommandLine -like "*$Root*" -or $_.CommandLine -like "*KubeDeck-Portable*" -or $_.CommandLine -like "*kubedeck-backend*" -or $_.CommandLine -like "*KubeDeck Backend*")
            } |
            ForEach-Object {
                Write-Info "Stopping process $($_.Name) PID=$($_.ProcessId)"
                Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
            }
    }
    catch {
        Write-Host "Could not inspect process command lines; falling back to process names. $($_.Exception.Message)" -ForegroundColor Yellow
        Get-Process -ErrorAction SilentlyContinue |
            Where-Object {
                $_.Id -ne $SelfPid -and
                ($_.ProcessName -in @("KubeDeck", "electron", "kubedeck-backend", "KubeDeck Backend") -or $_.ProcessName -like "KubeDeck-Portable*")
            } |
            ForEach-Object {
                Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
            }
    }
}

function Copy-DirectoryClean {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination
    )

    if (Test-Path $Destination) {
        Remove-Item -LiteralPath $Destination -Recurse -Force
    }

    Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force
}

function Assert-NoBundledKubectl {
    param([Parameter(Mandatory = $true)][string]$ReleaseDir)

    if (-not (Test-Path $ReleaseDir)) {
        throw "Release directory was not created: $ReleaseDir"
    }

    $BundledKubectl = Get-ChildItem -Path $ReleaseDir -Recurse -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -ieq "kubectl.exe" }

    if ($BundledKubectl) {
        $Paths = ($BundledKubectl | ForEach-Object { $_.FullName }) -join "; "
        throw "Portable release must not contain kubectl.exe. Found: $Paths"
    }

    Write-Ok "kubectl.exe is not bundled into the release output."
}

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
$RootPackageJson = Join-Path $Root "package.json"
$DesktopPackageJson = Join-Path $DesktopDir "package.json"
$RequirementsFile = Join-Path $BackendDir "requirements.lock.txt"

if (-not (Test-Path $RequirementsFile)) {
    $RequirementsFile = Join-Path $BackendDir "requirements.txt"
}

try {
    if (-not $IsWindows -and $PSVersionTable.PSEdition -eq "Core") {
        throw "Windows portable build must be run on Windows."
    }

    Set-Location $Root

    Write-Step "Validating project root"
    Assert-ProjectRoot -Path $Root
    $ProjectVersion = Assert-VersionConsistency -RootPackageJson $RootPackageJson -DesktopPackageJson $DesktopPackageJson

    Write-Step "Checking required commands"
    Assert-Command "node"
    Assert-Command "npm.cmd"
    Assert-Command "py"
    Write-Ok "Required commands OK."

    Write-Step "Checking npm dependencies"
    Ensure-NpmDependencies -Root $Root -Install:$InstallNpmDeps

    Write-Step "Repairing electron-builder 7zip helper"
    $Repair7zipScript = Join-Path $Root "scripts\repair-7zip-bin.ps1"
    if (-not (Test-Path $Repair7zipScript)) {
        throw "Missing repair script: $Repair7zipScript"
    }
    & $Repair7zipScript

    Write-Step "Preparing isolated backend build Python venv"
    Ensure-BuildPythonVenv -BuildVenvDir $BuildVenvDir -BuildPythonExe $BuildPythonExe

    Write-Step "Installing backend Python dependencies into isolated venv"
    Invoke-Native $BuildPythonExe -m pip install --disable-pip-version-check -r "$RequirementsFile"

    Write-Step "Ensuring pinned PyInstaller is installed in isolated venv"
    Invoke-Native $BuildPythonExe -m pip install --disable-pip-version-check pyinstaller==6.11.1

    Write-Step "Cleaning packaging output"
    Stop-KubeDeckProcesses -Root $Root
    Start-Sleep -Milliseconds 500

    foreach ($PathToClean in @($BackendDist, $PyInstallerWork, $BackendOnedirDist, $ReleaseDir)) {
        if (Test-Path $PathToClean) {
            Remove-Item -LiteralPath $PathToClean -Recurse -Force
        }
    }

    New-Item -ItemType Directory -Force -Path $BackendDist | Out-Null
    New-Item -ItemType Directory -Force -Path $PyInstallerWork | Out-Null

    if (-not $SkipTypecheck) {
        Write-Step "Running TypeScript typecheck"
        Invoke-Native npm.cmd run typecheck
    }

    Write-Step "Building Electron renderer and main process"
    Invoke-Native npm.cmd run build

    Write-Step "Building backend executable"
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

    $BuiltBackendExe = Join-Path $BackendOnedirCollect "KubeDeck Backend.exe"
    $BuiltBackendInternal = Join-Path $BackendOnedirCollect "_internal"

    if (-not (Test-Path $BuiltBackendExe)) {
        throw "PyInstaller did not create backend exe: $BuiltBackendExe"
    }
    if (-not (Test-Path $BuiltBackendInternal)) {
        throw "PyInstaller did not create backend _internal directory: $BuiltBackendInternal"
    }

    Copy-Item -LiteralPath $BuiltBackendExe -Destination $BackendExe -Force
    Copy-DirectoryClean -Source $BuiltBackendInternal -Destination (Join-Path $BackendDist "_internal")

    if (-not (Test-Path $BackendExe)) {
        throw "Backend executable was not copied: $BackendExe"
    }

    Write-Ok "Backend executable prepared: $BackendExe"
    Write-Ok "Portable package uses user-provided kubectl only: Settings path or PATH."

    Write-Step "Building Windows portable package"
    Push-Location $DesktopDir
    try {
        $env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
        Invoke-Native npm.cmd run dist:win
    }
    finally {
        Pop-Location
    }

    Write-Step "Validating release output"
    Assert-NoBundledKubectl -ReleaseDir $ReleaseDir

    $PortableExe = Get-ChildItem -Path $ReleaseDir -Filter "*Portable*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $PortableExe) {
        $PortableExe = Get-ChildItem -Path $ReleaseDir -Filter "*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    }

    if (-not $PortableExe) {
        throw "No .exe was produced in release directory: $ReleaseDir"
    }

    Write-Host ""
    Write-Host "Done." -ForegroundColor Green
    Write-Host "Project version: $ProjectVersion" -ForegroundColor Green
    Write-Host "Build output:" -ForegroundColor Green
    Write-Host "  $($PortableExe.FullName)" -ForegroundColor Green
}
catch {
    Write-Host ""
    Write-Host "Portable build failed." -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
