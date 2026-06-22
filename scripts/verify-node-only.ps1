#requires -Version 5.1
<#
.SYNOPSIS
Validates KubeDeck Node-only source and optional release payload.
#>

[CmdletBinding()]
param(
    [string]$ProjectRoot,
    [string]$ReleaseDir = ""
)

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = Split-Path -Parent $PSScriptRoot
}


$ErrorActionPreference = "Stop"

function Write-Check {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host "[OK] $Message" -ForegroundColor Green
}

function Read-Text {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Required file is missing: $Path"
    }
    return [System.IO.File]::ReadAllText($Path)
}

function Read-Json {
    param([Parameter(Mandatory = $true)][string]$Path)
    return (Read-Text -Path $Path).TrimStart([char]0xFEFF) | ConvertFrom-Json
}

function Assert-NoPattern {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string[]]$Patterns,
        [Parameter(Mandatory = $true)][string]$Description
    )
    $Text = Read-Text -Path $Path
    foreach ($Pattern in $Patterns) {
        if ($Text -match $Pattern) {
            throw "$Description. Pattern '$Pattern' found in $Path"
        }
    }
}

$Root = [System.IO.Path]::GetFullPath($ProjectRoot)
$RootPackagePath = Join-Path $Root "package.json"
$DesktopPackagePath = Join-Path $Root "apps\desktop\package.json"
$RouteOwnershipPath = Join-Path $Root "apps\desktop\src\main\backend\routeOwnership.ts"
$MigrationStatusPath = Join-Path $Root "apps\desktop\src\main\backend\routes\migrationStatus.ts"
$MainPath = Join-Path $Root "apps\desktop\src\main\main.ts"
$GatewayPath = Join-Path $Root "apps\desktop\src\main\backend\gateway.ts"
$ClustersPath = Join-Path $Root "apps\desktop\src\main\backend\routes\clusters.ts"
$YamlPath = Join-Path $Root "apps\desktop\src\main\backend\routes\yaml.ts"
$BuilderPath = Join-Path $Root "scripts\build-portable-windows.ps1"
$SetupPath = Join-Path $Root "scripts\setup-windows.ps1"
$ReadmePath = Join-Path $Root "README.md"
$DesktopBuilderPath = Join-Path $Root "apps\desktop\electron-builder.yml"

$RootPackage = Read-Json -Path $RootPackagePath
$DesktopPackage = Read-Json -Path $DesktopPackagePath
if ($RootPackage.version -ne $DesktopPackage.version) {
    throw "Version mismatch: root=$($RootPackage.version), desktop=$($DesktopPackage.version)"
}
if (-not $RootPackage.scripts.'verify:node-only') {
    throw "Root package.json is missing scripts.verify:node-only"
}
if ($DesktopPackage.scripts.'test:gateway' -notmatch 'node-only-runtime\.contract\.test\.cjs') {
    throw "Desktop test:gateway does not include node-only-runtime.contract.test.cjs"
}
Write-Check "Version consistency: $($RootPackage.version)"

$ForbiddenPaths = @(
    "apps\backend",
    "apps\desktop\src\main\backend\legacyProxy.ts",
    "apps\desktop\src\main\backend\legacyControl.ts"
)
foreach ($RelativePath in $ForbiddenPaths) {
    $Target = Join-Path $Root $RelativePath
    if (Test-Path -LiteralPath $Target) {
        throw "Forbidden legacy path exists: $Target"
    }
}
Write-Check "Legacy Python source and proxy files are absent"

$RuntimePatterns = @(
    'startBackend',
    'waitForBackendReady',
    'kubedeck_backend',
    'KUBEDECK_BACKEND_PORT',
    'legacyBackendUrl',
    'legacyProcessId',
    'legacyProxy',
    'proxyHttpRequest',
    'proxyWebSocketUpgrade',
    'invalidateLegacyResourceCache',
    'clearLegacyResourceCache',
    'backend\.pid',
    'resources[\\/]backend'
)
foreach ($RuntimeFile in @($MainPath, $GatewayPath, $MigrationStatusPath, $ClustersPath, $YamlPath)) {
    Assert-NoPattern -Path $RuntimeFile -Patterns $RuntimePatterns -Description "Legacy runtime code is forbidden"
}
Write-Check "Electron main and Node Gateway contain no legacy Python runtime hooks"

$RouteText = Read-Text -Path $RouteOwnershipPath
$NodeOwners = ([regex]::Matches($RouteText, 'owner\s*:\s*["'']node["'']')).Count
$PythonOwners = ([regex]::Matches($RouteText, 'owner\s*:\s*["'']python["'']')).Count
if ($NodeOwners -ne 49 -or $PythonOwners -ne 0) {
    throw "Route ownership mismatch: Node=$NodeOwners, Python=$PythonOwners; expected 49/0"
}
Write-Check "Route ownership: Node 49 / Python 0"

$MigrationText = Read-Text -Path $MigrationStatusPath
if ($MigrationText -notmatch 'mode\s*:\s*["'']node-only["'']') {
    throw "migration/status must report mode=node-only"
}
if ($MigrationText -notmatch 'source\s*:\s*["'']node["'']') {
    throw "migration/status must report processes.source=node"
}
Write-Check "Migration status is permanently Node-only"

Assert-NoPattern -Path $BuilderPath -Patterns @(
    'PyInstaller',
    'pip\s+install',
    'requirements\.txt',
    'requirements\.lock\.txt',
    'apps[\\/]backend[\\/](?:requirements\.txt|kubedeck_backend|main\.py)',
    '\.build-venv',
    '\bpy\s+-3\b'
) -Description "Portable builder must remain Node-only"

Assert-NoPattern -Path $SetupPath -Patterns @(
    'Python\.Python',
    'pip\s+install',
    'apps[\\/]backend[\\/](?:requirements\.txt|kubedeck_backend|main\.py)',
    '\bpy\s+-3\b'
) -Description "Windows bootstrap must remain Node-only"

Assert-NoPattern -Path $DesktopBuilderPath -Patterns @(
    'build[\\/]backend',
    'to\s*:\s*backend'
) -Description "electron-builder must not bundle Python backend"

Assert-NoPattern -Path $ReadmePath -Patterns @(
    'pip\s+install',
    'apps[\\/]backend[\\/](?:requirements\.txt|kubedeck_backend|main\.py)',
    'Backend\s+Python\s*,\s*FastAPI',
    'локальный\s+Python\s+backend'
) -Description "README contains obsolete Python build/runtime instructions"
Write-Check "Build scripts and documentation are Node-only"

if ($ReleaseDir) {
    $ResolvedRelease = [System.IO.Path]::GetFullPath($ReleaseDir)
    if (-not (Test-Path -LiteralPath $ResolvedRelease)) {
        throw "Release directory does not exist: $ResolvedRelease"
    }

    $ForbiddenReleaseItems = Get-ChildItem -LiteralPath $ResolvedRelease -Recurse -Force -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Name -ieq 'kubectl.exe' -or
            $_.Name -in @('KubeDeck Backend.exe', 'kubedeck-backend.exe', 'python.exe', 'pythonw.exe') -or
            $_.Name -match '^python\d*\.dll$' -or
            $_.FullName -match '[\\/]resources[\\/]backend([\\/]|$)'
        }

    if ($ForbiddenReleaseItems) {
        $Paths = ($ForbiddenReleaseItems | ForEach-Object { $_.FullName }) -join '; '
        throw "Forbidden release payload found: $Paths"
    }
    Write-Check "Release contains no kubectl.exe or Python backend payload"
}

Write-Host ""
Write-Host "Node-only verification passed." -ForegroundColor Green
