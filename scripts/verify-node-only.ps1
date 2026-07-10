#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$ProjectRoot,
    [string]$ReleaseDir = ""
)

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) { $ProjectRoot = Split-Path -Parent $PSScriptRoot }
$Arguments = @((Join-Path $ProjectRoot "scripts\verify-release.cjs"))
if ($ReleaseDir) { $Arguments += @("--release-dir", $ReleaseDir, "--artifact", "windows") }
& node @Arguments
if ($LASTEXITCODE -ne 0) { throw "Node release verifier failed with exit code $LASTEXITCODE" }
