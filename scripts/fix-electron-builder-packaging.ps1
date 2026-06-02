$ErrorActionPreference = "Stop"

$Root = (Get-Location).Path
$Utf8NoBom = New-Object System.Text.UTF8Encoding -ArgumentList $false

function Write-TextNoBom {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$Text
    )

    $FullPath = (Resolve-Path $Path).Path
    [System.IO.File]::WriteAllText($FullPath, $Text, $Utf8NoBom)
}

Write-Host "==> Fix apps/desktop/package.json"

$DesktopPackagePath = ".\apps\desktop\package.json"
$pkg = Get-Content $DesktopPackagePath -Raw | ConvertFrom-Json

if (-not ($pkg.PSObject.Properties.Name -contains "description")) {
    $pkg | Add-Member -MemberType NoteProperty -Name "description" -Value "KubeDeck desktop Kubernetes IDE"
} elseif ([string]::IsNullOrWhiteSpace($pkg.description)) {
    $pkg.description = "KubeDeck desktop Kubernetes IDE"
}

if (-not ($pkg.PSObject.Properties.Name -contains "author")) {
    $pkg | Add-Member -MemberType NoteProperty -Name "author" -Value "KubeDeck"
} elseif ([string]::IsNullOrWhiteSpace($pkg.author)) {
    $pkg.author = "KubeDeck"
}

if (-not ($pkg.PSObject.Properties.Name -contains "devDependencies")) {
    $pkg | Add-Member -MemberType NoteProperty -Name "devDependencies" -Value ([pscustomobject]@{})
}

if ($pkg.PSObject.Properties.Name -contains "dependencies") {
    foreach ($dep in $pkg.dependencies.PSObject.Properties) {
        if (-not ($pkg.devDependencies.PSObject.Properties.Name -contains $dep.Name)) {
            $pkg.devDependencies | Add-Member -MemberType NoteProperty -Name $dep.Name -Value $dep.Value
            Write-Host "Moved dependency to devDependencies: $($dep.Name)"
        }
    }

    $pkg.PSObject.Properties.Remove("dependencies")
}

$pkg.scripts."dist:win" = "electron-builder --win --x64 --config.npmRebuild=false"

$pkgJson = $pkg | ConvertTo-Json -Depth 100
Write-TextNoBom -Path $DesktopPackagePath -Text ($pkgJson + [Environment]::NewLine)

Write-Host "==> Fix electron-builder.yml"

$BuilderPath = ".\apps\desktop\electron-builder.yml"
$yml = Get-Content $BuilderPath -Raw

$yml = [regex]::Replace($yml, "(?m)^(npmRebuild|nodeGypRebuild|buildDependenciesFromSource):.*\r?\n?", "")

$builderFlags = @"
npmRebuild: false
nodeGypRebuild: false
buildDependenciesFromSource: false

"@

if ($yml -match "(?m)^electronVersion:") {
    $yml = [regex]::Replace(
        $yml,
        "(?m)^(electronVersion:.*\r?\n)",
        "`$1`r`n$builderFlags",
        1
    )
} else {
    $yml = $builderFlags + $yml
}

Write-TextNoBom -Path $BuilderPath -Text $yml

Write-Host "==> Install 7zip-bin as explicit desktop devDependency"

npm.cmd install -D 7zip-bin@5.2.0 --workspace apps/desktop

Write-Host "==> Verify 7za.exe"

$SevenZipPath = ".\node_modules\7zip-bin\win\x64\7za.exe"

if (-not (Test-Path $SevenZipPath)) {
    Write-Host "7za.exe not found in expected path, searching..." -ForegroundColor Yellow

    $found = Get-ChildItem -Path .\node_modules -Recurse -Filter 7za.exe -ErrorAction SilentlyContinue |
        Select-Object -First 1

    if (-not $found) {
        throw "7za.exe not found anywhere in node_modules"
    }

    New-Item -ItemType Directory -Path (Split-Path $SevenZipPath -Parent) -Force | Out-Null
    Copy-Item $found.FullName $SevenZipPath -Force
}

if (-not (Test-Path $SevenZipPath)) {
    throw "7za.exe still missing: $SevenZipPath"
}

Write-Host "7za.exe OK: $SevenZipPath" -ForegroundColor Green

Write-Host "==> Done"
