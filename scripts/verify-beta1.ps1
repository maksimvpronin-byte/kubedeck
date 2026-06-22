#requires -Version 5.1
<#
.SYNOPSIS
Validates KubeDeck 2.0.0-beta.1 release-readiness invariants.
#>

[CmdletBinding()]
param(
    [string]$ProjectRoot,
    [string]$ReleaseDir = ""
)

$ErrorActionPreference = "Stop"
$ExpectedVersion = "2.0.0-beta.1"

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = Split-Path -Parent $PSScriptRoot
}

function Write-Check {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host "[OK] $Message" -ForegroundColor Green
}

function Read-Json {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Required file is missing: $Path"
    }
    $Raw = [System.IO.File]::ReadAllText($Path).TrimStart([char]0xFEFF)
    Add-Type -AssemblyName System.Web.Extensions

    $Serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
    $Serializer.MaxJsonLength = [int]::MaxValue
    $Serializer.RecursionLimit = 1024

    return $Serializer.DeserializeObject($Raw)
}

function Read-Text {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Required file is missing: $Path"
    }
    return [System.IO.File]::ReadAllText($Path)
}

$Root = [System.IO.Path]::GetFullPath($ProjectRoot)
$NodeOnlyVerifier = Join-Path $Root "scripts\verify-node-only.ps1"

& $NodeOnlyVerifier -ProjectRoot $Root -ReleaseDir $ReleaseDir

$RootPackage = Read-Json -Path (Join-Path $Root "package.json")
$DesktopPackage = Read-Json -Path (Join-Path $Root "apps\desktop\package.json")
$Lock = Read-Json -Path (Join-Path $Root "package-lock.json")

$Versions = @(
    $RootPackage.version,
    $DesktopPackage.version,
    $Lock.version,
    $Lock.packages.PSObject.Properties[''].Value.version,
    $Lock.packages.PSObject.Properties['apps/desktop'].Value.version
)
    $Versions = @($Versions | ForEach-Object {
        if ($null -ne $_) { "$_".Trim() }
    } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })

if ($Versions | Where-Object { $_ -ne $ExpectedVersion }) {
    throw "Beta version mismatch. Expected $ExpectedVersion; found: $($Versions -join ', ')"
}
Write-Check "Beta version consistency: $ExpectedVersion"

if (-not $RootPackage.scripts.'verify:beta1') {
    throw "Root package.json is missing scripts.verify:beta1"
}

$GatewayScript = [string]$DesktopPackage.scripts.'test:gateway'
if ($GatewayScript -notmatch '--test-concurrency=1') {
    throw "test:gateway must run with --test-concurrency=1"
}
if ($GatewayScript -notmatch 'node-only-runtime\.contract\.test\.cjs') {
    throw "test:gateway is missing node-only-runtime.contract.test.cjs"
}
if ($GatewayScript -notmatch 'beta1-release\.contract\.test\.cjs') {
    throw "test:gateway is missing beta1-release.contract.test.cjs"
}
Write-Check "Gateway test suite is deterministic and includes release contracts"

$RequiredDocuments = @(
    "README.md",
    "NODE_MIGRATION_PROGRESS.md",
    "RELEASE_NOTES_2.0.0-beta.1.md",
    "BETA_REGRESSION_CHECKLIST.md"
)
foreach ($Relative in $RequiredDocuments) {
    if (-not (Test-Path -LiteralPath (Join-Path $Root $Relative))) {
        throw "Required beta document is missing: $Relative"
    }
}

$Readme = Read-Text -Path (Join-Path $Root "README.md")
$ReleaseNotes = Read-Text -Path (Join-Path $Root "RELEASE_NOTES_2.0.0-beta.1.md")
$Checklist = Read-Text -Path (Join-Path $Root "BETA_REGRESSION_CHECKLIST.md")
if ($Readme -notmatch [regex]::Escape($ExpectedVersion)) {
    throw "README does not mention $ExpectedVersion"
}
if ($ReleaseNotes -notmatch 'Node-only' -or $ReleaseNotes -notmatch '49') {
    throw "Release notes do not describe the Node-only 49-route baseline"
}
if ($Checklist -notmatch 'Node 49 / Python 0' -or $Checklist -notmatch 'Port Forward') {
    throw "Regression checklist is incomplete"
}
Write-Check "Beta release notes and regression checklist are present"

if ($ReleaseDir) {
    $ExpectedArtifact = Join-Path ([System.IO.Path]::GetFullPath($ReleaseDir)) "KubeDeck-Portable-$ExpectedVersion-x64.exe"
    if (-not (Test-Path -LiteralPath $ExpectedArtifact)) {
        throw "Expected beta portable artifact is missing: $ExpectedArtifact"
    }
    Write-Check "Expected portable artifact exists: $(Split-Path -Leaf $ExpectedArtifact)"
}

Write-Host ""
Write-Host "KubeDeck $ExpectedVersion verification passed." -ForegroundColor Green
