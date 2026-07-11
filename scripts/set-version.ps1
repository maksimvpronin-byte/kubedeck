param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?$')]
    [string]$Version
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-Utf8NoBom {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$Content
    )

    [System.IO.File]::WriteAllText((Resolve-Path $Path), $Content, $utf8NoBom)
}

function Update-PackageJsonVersion {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$Version
    )

    if (-not (Test-Path $Path)) {
        Write-Host "Skip missing: $Path"
        return
    }

    $content = Get-Content $Path -Raw -Encoding UTF8
    $content = $content -replace '(?m)("version"\s*:\s*")[^"]+(")', "`${1}$Version`${2}"
    Write-Utf8NoBom -Path $Path -Content $content
    Write-Host "Updated: $Path"
}

function Update-PyProjectVersion {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$Version
    )

    if (-not (Test-Path $Path)) {
        Write-Host "Skip missing: $Path"
        return
    }

    $content = Get-Content $Path -Raw -Encoding UTF8

    if ($content -notmatch '(?m)^version\s*=') {
        throw "No version field found in $Path"
    }

    $content = $content -replace '(?m)^version\s*=\s*"[^"]+"', "version = `"$Version`""
    Write-Utf8NoBom -Path $Path -Content $content
    Write-Host "Updated: $Path"
}

function Remove-Utf8BomIfPresent {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path $Path)) {
        return
    }

    $bytes = [System.IO.File]::ReadAllBytes((Resolve-Path $Path))
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        $text = [System.Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3)
        Write-Utf8NoBom -Path $Path -Content $text
        Write-Host "Removed UTF-8 BOM: $Path"
    }
}

Write-Host "==> Setting KubeDeck version to $Version"

Update-PackageJsonVersion -Path ".\package.json" -Version $Version
Update-PackageJsonVersion -Path ".\apps\desktop\package.json" -Version $Version
Update-PackageJsonVersion -Path ".\packages\shared-types\package.json" -Version $Version

Write-Host "==> Removing UTF-8 BOM from config files"
@(
    ".\package.json",
    ".\package-lock.json",
    ".\apps\desktop\package.json",
    ".\packages\shared-types\package.json",
    ".\apps\desktop\vite.config.mts"
) | ForEach-Object { Remove-Utf8BomIfPresent -Path $_ }

Write-Host "==> Updating package-lock.json"
npm.cmd install --package-lock-only --ignore-scripts

Write-Host "==> Removing UTF-8 BOM from package-lock.json"
Remove-Utf8BomIfPresent -Path ".\package-lock.json"

Write-Host "==> Version check"
Select-String -Path .\package.json,.\apps\desktop\package.json,.\packages\shared-types\package.json -Pattern '"version"'

Write-Host "==> Done"
