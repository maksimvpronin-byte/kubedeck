#requires -Version 5.1
<#
.SYNOPSIS
KubeDeck Node-only Windows bootstrap script.

.DESCRIPTION
Installs/checks Git, Node.js and kubectl, prepares npm dependencies, and can
build the portable KubeDeck executable. Python is not required.
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
        [string[]]$Arguments = @()
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

function Install-WingetPackage {
    param(
        [Parameter(Mandatory = $true)][string]$Id,
        [Parameter(Mandatory = $true)][string]$DisplayName
    )

    Write-Host "Installing $DisplayName ($Id) ..."
    Invoke-Native -FilePath "winget" -Arguments @(
        "install", "-e", "--id", $Id,
        "--accept-source-agreements", "--accept-package-agreements"
    )
    Refresh-CurrentProcessPath
}

function Get-NodeMajor {
    if (-not (Test-Command -Name "node")) { return 0 }
    $version = (& node --version 2>$null).Trim()
    if ($version -match "^v?(\d+)\.") { return [int]$Matches[1] }
    return 0
}

function Ensure-Prerequisites {
    if ($env:OS -ne "Windows_NT") {
        throw "This setup script is intended for Windows only."
    }

    if ($SkipPrerequisites) {
        Write-Host "Skipping automatic prerequisite installation." -ForegroundColor Yellow
    }
    else {
        if (-not (Test-Command -Name "winget")) {
            throw "winget was not found. Install/update App Installer and rerun the script."
        }

        if (-not (Test-Command -Name "git")) {
            Install-WingetPackage -Id "Git.Git" -DisplayName "Git"
        }
        if ((Get-NodeMajor) -lt 20) {
            Install-WingetPackage -Id "OpenJS.NodeJS.LTS" -DisplayName "Node.js LTS"
        }
        if (-not (Test-Command -Name "kubectl")) {
            Install-WingetPackage -Id "Kubernetes.kubectl" -DisplayName "kubectl"
        }
    }

    Refresh-CurrentProcessPath
    foreach ($Command in @("git", "node", "npm.cmd", "kubectl")) {
        if (-not (Test-Command -Name $Command)) {
            throw "Required command '$Command' was not found."
        }
    }

    Write-Host "Git: $(& git --version)"
    Write-Host "Node.js: $(& node --version)"
    Write-Host "npm: $(& npm.cmd --version)"
    & kubectl version --client
}

function Test-RepoRoot {
    param([Parameter(Mandatory = $true)][string]$Path)
    return (
        (Test-Path -LiteralPath (Join-Path $Path "package.json")) -and
        (Test-Path -LiteralPath (Join-Path $Path "apps\desktop\package.json"))
    )
}

function Resolve-Repository {
    $scriptRootCandidate = if ($PSScriptRoot) {
        [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
    } else { "" }

    if ($scriptRootCandidate -and (Test-RepoRoot -Path $scriptRootCandidate)) {
        return $scriptRootCandidate
    }

    $current = (Get-Location).Path
    if (Test-RepoRoot -Path $current) {
        return $current
    }

    if (-not $Clone) {
        throw "Project root was not found. Run from the repository root or use -Clone."
    }

    if (Test-Path -LiteralPath $ProjectDir) {
        if (-not (Test-RepoRoot -Path $ProjectDir)) {
            throw "ProjectDir exists but is not a KubeDeck repository: $ProjectDir"
        }
        return (Resolve-Path -LiteralPath $ProjectDir).Path
    }

    Write-Section "Cloning KubeDeck"
    Invoke-Native -FilePath "git" -Arguments @("clone", $RepoUrl, $ProjectDir)
    return (Resolve-Path -LiteralPath $ProjectDir).Path
}

try {
    Write-Section "Checking prerequisites"
    Ensure-Prerequisites

    $Root = Resolve-Repository
    Set-Location $Root
    Write-Host "Using project directory: $Root"

    Write-Section "Installing npm dependencies"
    Invoke-Native -FilePath "npm.cmd" -Arguments @("ci", "--no-audit", "--no-fund")

    if ($Build) {
        Write-Section "Building Node-only portable package"
        & (Join-Path $Root "scripts\build-portable-windows.ps1")
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }

    if ($Dev) {
        Write-Section "Starting KubeDeck development mode"
        Invoke-Native -FilePath "npm.cmd" -Arguments @("run", "dev")
    }

    if (-not $Build -and -not $Dev) {
        Write-Host "Setup completed. Use -Build for portable packaging or -Dev for development mode." -ForegroundColor Green
    }
}
catch {
    Write-Host ""
    Write-Host "Setup failed." -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
