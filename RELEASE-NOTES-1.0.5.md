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
