#requires -Version 5.1
<#
.SYNOPSIS
Canonical KubeDeck Node-only Windows portable builder.

.DESCRIPTION
Runs source verification, typecheck, desktop build, Gateway tests,
electron-builder packaging, and release-payload verification.
Python is not required and npm dependencies are not reinstalled unless
-InstallNpmDeps is explicitly supplied.
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
        [string[]]$Arguments = @()
    )
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
    }
}

function Read-JsonFile {
    param([Parameter(Mandatory = $true)][string]$Path)
    return (Get-Content -LiteralPath $Path -Raw).TrimStart([char]0xFEFF) | ConvertFrom-Json
}

function Assert-ProjectRoot {
    param([Parameter(Mandatory = $true)][string]$Path)
    foreach ($RelativePath in @(
        "package.json",
        "apps\desktop\package.json",
        "apps\desktop\src\main\main.ts",
        "scripts\verify-node-only.ps1"
    )) {
        $FullPath = Join-Path $Path $RelativePath
        if (-not (Test-Path -LiteralPath $FullPath)) {
            throw "This script must be run from the KubeDeck repository root. Missing: $RelativePath"
        }
    }
}

function Assert-VersionConsistency {
    param(
        [Parameter(Mandatory = $true)][string]$RootPackageJson,
        [Parameter(Mandatory = $true)][string]$DesktopPackageJson
    )
    $RootPkg = Read-JsonFile -Path $RootPackageJson
    $DesktopPkg = Read-JsonFile -Path $DesktopPackageJson
    if ($RootPkg.version -ne $DesktopPkg.version) {
        throw "Version mismatch: package.json=$($RootPkg.version), apps/desktop/package.json=$($DesktopPkg.version)"
    }
    Write-Ok "Project version: $($RootPkg.version)"
    return $RootPkg.version
}

function Test-NpmDependenciesReady {
    param([Parameter(Mandatory = $true)][string]$Root)
    foreach ($RelativeBin in @(
        "node_modules\.bin\tsc.cmd",
        "node_modules\.bin\vite.cmd",
        "node_modules\.bin\electron-builder.cmd"
    )) {
        if (-not (Test-Path -LiteralPath (Join-Path $Root $RelativeBin))) {
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
        throw "npm dependencies are incomplete. Run 'npm.cmd ci --no-audit --no-fund', or rerun with -InstallNpmDeps."
    }
    Write-Info "Installing npm dependencies because -InstallNpmDeps was specified."
    Invoke-Native -FilePath "npm.cmd" -Arguments @("ci", "--no-audit", "--no-fund")
    if (-not (Test-NpmDependenciesReady -Root $Root)) {
        throw "npm dependencies are still incomplete after npm ci."
    }
}

function Ensure-RollupNativeModule {
    param([Parameter(Mandatory = $true)][string]$Root)
    Push-Location $Root
    try {
        & node -e "require('rollup')" 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Ok "Rollup native module OK."
            return
        }
        $RollupVersion = (& node -p "require('./node_modules/rollup/package.json').version").Trim()
        if (-not $RollupVersion) {
            throw "Unable to determine installed Rollup version."
        }
        Write-Info "Repairing missing Rollup Windows optional dependency for version $RollupVersion."
        Invoke-Native -FilePath "npm.cmd" -Arguments @(
            "install",
            "--no-save",
            "--package-lock=false",
            "@rollup/rollup-win32-x64-msvc@$RollupVersion"
        )
    }
    finally {
        Pop-Location
    }
}

function Stop-KubeDeckProcesses {
    param([Parameter(Mandatory = $true)][string]$Root)
    $SelfPid = $PID
    try {
        Get-CimInstance Win32_Process | Where-Object {
            $_.ProcessId -ne $SelfPid -and
            $_.Name -in @("KubeDeck.exe", "electron.exe", "node.exe") -and
            ($_.CommandLine -like "*$Root*" -or $_.CommandLine -like "*KubeDeck-Portable*")
        } | ForEach-Object {
            Write-Info "Stopping process $($_.Name) PID=$($_.ProcessId)"
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }
    }
    catch {
        Write-Host "Could not inspect process command lines: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

function Invoke-NodeOnlyVerification {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [string]$Release = ""
    )
    $VerifyScript = Join-Path $Root "scripts\verify-node-only.ps1"
    $Arguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $VerifyScript, "-ProjectRoot", $Root)
    if ($Release) {
        $Arguments += @("-ReleaseDir", $Release)
    }
    Invoke-Native -FilePath "powershell.exe" -Arguments $Arguments
}

$Root = Split-Path -Parent $PSScriptRoot
$DesktopDir = Join-Path $Root "apps\desktop"
$ReleaseDir = Join-Path $DesktopDir "release"
$RootPackageJson = Join-Path $Root "package.json"
$DesktopPackageJson = Join-Path $DesktopDir "package.json"

try {
    if ($env:OS -ne "Windows_NT") {
        throw "Windows portable build must be run on Windows."
    }

    Set-Location $Root

    Write-Step "Validating Node-only project"
    Assert-ProjectRoot -Path $Root
    $ProjectVersion = Assert-VersionConsistency `
        -RootPackageJson $RootPackageJson `
        -DesktopPackageJson $DesktopPackageJson
    Invoke-NodeOnlyVerification -Root $Root

    Write-Step "Checking required commands"
    Assert-Command -Name "node"
    Assert-Command -Name "npm.cmd"
    Assert-Command -Name "powershell.exe"
    Write-Ok "Required commands OK. Python is not required."

    Write-Step "Checking npm dependencies"
    Ensure-NpmDependencies -Root $Root -Install:$InstallNpmDeps

    Write-Step "Repairing electron-builder helpers"
    $Repair7zipScript = Join-Path $Root "scripts\repair-7zip-bin.ps1"
    if (-not (Test-Path -LiteralPath $Repair7zipScript)) {
        throw "Missing repair script: $Repair7zipScript"
    }
    & $Repair7zipScript
    Ensure-RollupNativeModule -Root $Root

    Write-Step "Cleaning packaging output"
    Stop-KubeDeckProcesses -Root $Root
    Start-Sleep -Milliseconds 500
    if (Test-Path -LiteralPath $ReleaseDir) {
        Remove-Item -LiteralPath $ReleaseDir -Recurse -Force
    }

    if (-not $SkipTypecheck) {
        Write-Step "Running TypeScript typecheck"
        Invoke-Native -FilePath "npm.cmd" -Arguments @("run", "typecheck")
    }

    Write-Step "Building Electron renderer and main process"
    Invoke-Native -FilePath "npm.cmd" -Arguments @("run", "build")

    Write-Step "Running Node Gateway contract tests"
    Invoke-Native -FilePath "npm.cmd" -Arguments @(
        "--workspace", "apps/desktop", "run", "test:gateway"
    )

    Write-Step "Building Windows portable package"
    Push-Location $DesktopDir
    try {
        $env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
        Invoke-Native -FilePath "npm.cmd" -Arguments @("run", "dist:win")
    }
    finally {
        Pop-Location
    }

    Write-Step "Validating release output"
    Invoke-NodeOnlyVerification -Root $Root -Release $ReleaseDir

    $PortableExe = Get-ChildItem -Path $ReleaseDir -Filter "*Portable*.exe" -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $PortableExe) {
        throw "No portable .exe was produced in: $ReleaseDir"
    }

    Write-Host ""
    Write-Host "Done." -ForegroundColor Green
    Write-Host "Project version: $ProjectVersion" -ForegroundColor Green
    Write-Host "Node-only portable output:" -ForegroundColor Green
    Write-Host "  $($PortableExe.FullName)" -ForegroundColor Green
}
catch {
    Write-Host ""
    Write-Host "Portable build failed." -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
