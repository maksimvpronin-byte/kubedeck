param(
  [switch]$RemoveBackups
)

$ErrorActionPreference = 'Stop'

$ScriptPath = $MyInvocation.MyCommand.Path
$ScriptsDir = Split-Path -Parent $ScriptPath
$ProjectRoot = Split-Path -Parent $ScriptsDir

function Info($Message) {
  Write-Host $Message -ForegroundColor Cyan
}

function Ok($Message) {
  Write-Host $Message -ForegroundColor Green
}

function Warn($Message) {
  Write-Host $Message -ForegroundColor Yellow
}

function Remove-PathSafe($Path) {
  if (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
    Write-Host "removed: $Path" -ForegroundColor DarkGray
  }
}

Info "==> Finalizing KubeDeck 1.0.5 in $ProjectRoot"

$rootPackage = Join-Path $ProjectRoot 'package.json'
if (-not (Test-Path -LiteralPath $rootPackage)) {
  throw "package.json was not found in project root: $ProjectRoot"
}

# 1. Remove extracted temporary patch/hotfix directories from the project root.
Info "==> Removing extracted temporary 1.0.5 patch folders"
Get-ChildItem -LiteralPath $ProjectRoot -Directory -Force | Where-Object {
  $_.Name -like 'kubedeck-1.0.5-*hotfix*' -or
  $_.Name -like 'kubedeck-1.0.5-*patch*'
} | ForEach-Object {
  Remove-PathSafe $_.FullName
}

# 2. Remove temporary README files created by intermediate hotfixes.
Info "==> Removing temporary 1.0.5 hotfix README files"
Get-ChildItem -LiteralPath $ProjectRoot -File -Force | Where-Object {
  $_.Name -match '^README-.*1\.0\.5.*\.md$' -or
  $_.Name -match '^CHANGELOG-.*1\.0\.5.*\.md$'
} | ForEach-Object {
  Remove-PathSafe $_.FullName
}

# 3. Remove temporary 1.0.5 hotfix scripts, keep validate/package/finalize scripts.
Info "==> Removing temporary 1.0.5 hotfix scripts"
if (Test-Path -LiteralPath $ScriptsDir) {
  Get-ChildItem -LiteralPath $ScriptsDir -File -Filter '*.ps1' | Where-Object {
    ($_.Name -like 'fix-kubedeck-1.0.5-*.ps1' -or $_.Name -eq 'apply-kubedeck-1.0.5.ps1') -and
    $_.Name -ne 'finalize-kubedeck-1.0.5.ps1' -and
    $_.Name -ne 'validate-1.0.5.ps1' -and
    $_.Name -ne 'package-windows.ps1'
  } | ForEach-Object {
    Remove-PathSafe $_.FullName
  }
}

# 4. Optionally remove patch backup directories. Default is to keep backups.
if ($RemoveBackups) {
  Info "==> Removing 1.0.5 patch backups"
  $backupRoot = Join-Path $ProjectRoot '.kubedeck_patch_backup'
  if (Test-Path -LiteralPath $backupRoot) {
    Get-ChildItem -LiteralPath $backupRoot -Directory -Force | Where-Object {
      $_.Name -like '1.0.5-*'
    } | ForEach-Object {
      Remove-PathSafe $_.FullName
    }
  }
} else {
  Warn "==> Backups are kept. Run this script with -RemoveBackups only after you are sure the build is stable."
}

# 5. Write final release notes.
Info "==> Writing RELEASE-NOTES-1.0.5.md"
$releaseNotes = @'
# KubeDeck 1.0.5

Final stabilization build for KubeDeck 1.0.5.

## Added

- Node actions in the Nodes view:
  - Cordon
  - Uncordon
  - Drain
- Pod restart diagnostics in the Pod Summary panel.
- Settings save feedback: saving, success and error states.

## Fixed

- Nodes toolbar actions are active immediately after application startup.
- Refresh is active immediately after application startup.
- Resource tables no longer show cached rows as live data when the cluster becomes unavailable.
- Detail drawer is reset when live resource refresh fails.
- Cluster can be refreshed again after unavailable -> available without restarting the application.
- Namespace pills styling was restored.
- Table toolbar button styling was aligned with the dark UI.
- Resource list responsive layout was fixed for narrow windows.
- Pod Summary layout was restored after adding restart diagnostics.
- Sort indicator mojibake/broken symbols were removed.
- Windows PowerShell 5.1 compatibility issues in intermediate patch scripts were fixed.

## Notes

- Resource cache remains available as a diagnostic tool in Settings.
- Main resource tables should use fresh kubectl data and must not silently present stale cache as live cluster state.
- The final portable artifact should be produced by scripts/validate-1.0.5.ps1 -Package.
'@
Set-Content -LiteralPath (Join-Path $ProjectRoot 'RELEASE-NOTES-1.0.5.md') -Value $releaseNotes -Encoding UTF8

# 6. Insert CHANGELOG entry if CHANGELOG.md exists and has no 1.0.5 entry yet.
$changeLogPath = Join-Path $ProjectRoot 'CHANGELOG.md'
$changeLogEntry = @'
## 1.0.5 - 2026-06-17

### Added

- Node actions: Cordon, Uncordon, Drain.
- Pod restart diagnostics in Pod Summary.
- Settings save feedback.

### Fixed

- Nodes actions and Refresh disabled state after application startup.
- Stale cached resource rows shown as live data when a cluster becomes unavailable.
- Reconnect flow after unavailable -> available.
- Namespace pill styling.
- Action button styling in resource table toolbars.
- Responsive layout for resource lists and detail drawer.
- Pod Summary layout after restart diagnostics.
- Broken sort indicator symbols in table headers.

'@

if (Test-Path -LiteralPath $changeLogPath) {
  $existingChangeLog = Get-Content -LiteralPath $changeLogPath -Raw
  if ($existingChangeLog -notmatch '##\s+1\.0\.5\b') {
    Info "==> Inserting 1.0.5 entry into CHANGELOG.md"
    Set-Content -LiteralPath $changeLogPath -Value ($changeLogEntry + $existingChangeLog) -Encoding UTF8
  } else {
    Ok "==> CHANGELOG.md already contains a 1.0.5 entry"
  }
} else {
  Info "==> Creating CHANGELOG.md"
  Set-Content -LiteralPath $changeLogPath -Value ("# Changelog`r`n`r`n" + $changeLogEntry) -Encoding UTF8
}

# 7. Quick final status report.
Info "==> Remaining 1.0.5 scripts"
if (Test-Path -LiteralPath $ScriptsDir) {
  Get-ChildItem -LiteralPath $ScriptsDir -File -Filter '*1.0.5*.ps1' | Sort-Object Name | ForEach-Object {
    Write-Host (' - ' + $_.Name)
  }
}

Ok "==> KubeDeck 1.0.5 final cleanup completed."
Ok "==> Now run: powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate-1.0.5.ps1 -Package"
