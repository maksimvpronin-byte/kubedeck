# KubeDeck 2.33.0 release notes

## Exclude namespaces

In **All namespaces**, choose **Exclude** next to any namespace. The selector
shows **All except N**, and **Restore** brings a namespace back. KubeDeck
remembers your selection per cluster, and newly created namespaces appear
automatically. Individual checkboxes still select specific namespaces.

The exclusions apply to resource tables, Global Search and Overview.

## Search logs with context

Search now keeps surrounding lines visible and highlights each match. Turn on
**Matches only** to see just the matching lines. Use the arrows, Enter or
Shift+Enter to step through matches. **Current view** downloads the lines
shown in the selected mode.

## Dependency fixes

- Joi 17.13.9 resolves [GHSA-4528-x5fx-h6hg](https://github.com/advisories/GHSA-4528-x5fx-h6hg) in the development toolchain.
- minimatch 11.0.1 resolves [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) in the affected Electron packaging dependencies.
- The build toolchain still includes picomatch 4.0.7, which is affected by [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf).

The Node-only gateway provides 60 routes.

[Regression checklist](https://github.com/maksimvpronin-byte/kubedeck/blob/v2.33.0/docs/releases/REGRESSION_CHECKLIST_2.33.0.md)
