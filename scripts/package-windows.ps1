<#
Compatibility wrapper.
The canonical Windows portable builder is scripts/build-portable-windows.ps1.
#>

$ErrorActionPreference = "Stop"
$Builder = Join-Path $PSScriptRoot "build-portable-windows.ps1"

if (-not (Test-Path $Builder)) {
    throw "Missing portable builder: $Builder"
}

& $Builder @args
exit $LASTEXITCODE
