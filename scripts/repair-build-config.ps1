$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Remove-Utf8BomIfPresent {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path $Path)) { return }
    $resolved = Resolve-Path $Path
    $bytes = [System.IO.File]::ReadAllBytes($resolved)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        $text = [System.Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3)
        [System.IO.File]::WriteAllText($resolved, $text, $utf8NoBom)
        Write-Host "Removed UTF-8 BOM: $Path"
    }
}

Write-Host "==> Remove accidental PostCSS config files"
Get-ChildItem -Path . -Recurse -Force -File -ErrorAction SilentlyContinue | Where-Object {
    $_.FullName -notmatch '\\node_modules\\' -and
    $_.FullName -notmatch '\\release\\' -and
    $_.FullName -notmatch '\\build\\' -and
    (
        $_.Name -eq ".postcssrc" -or
        $_.Name -like ".postcssrc.*" -or
        $_.Name -like "postcss.config.*"
    )
} | ForEach-Object {
    Write-Host "Removing $($_.FullName)"
    Remove-Item $_.FullName -Force
}

Write-Host "==> Remove UTF-8 BOM from project config files"
Get-ChildItem -Path . -Recurse -Force -File -ErrorAction SilentlyContinue | Where-Object {
    $_.FullName -notmatch '\\node_modules\\' -and
    $_.FullName -notmatch '\\release\\' -and
    $_.FullName -notmatch '\\build\\' -and
    $_.Extension -in @('.json', '.toml', '.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs', '.css', '.html', '.yml', '.yaml', '.md', '.ps1')
} | ForEach-Object {
    Remove-Utf8BomIfPresent -Path $_.FullName
}

Write-Host "==> Done"
