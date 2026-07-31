# KubeDeck 2.9.1 release notes

KubeDeck 2.9.1 is a focused patch release for interactive terminal workflows and release metadata.

## Unified terminal workspace

- Node SSH now opens in the same persistent bottom workspace as Pod Terminal instead of inside the resource drawer.
- Up to five Pod or SSH sessions can remain mounted while the user navigates between resources, clusters, and drawer tabs.
- The workspace can be resized vertically with a pointer or keyboard, collapsed, expanded, and closed explicitly.
- The Pod xterm viewport expands and shrinks with the workspace and synchronizes the resulting PTY row count.
- The last valid panel height is saved locally and clamped when the application window changes size.
- SSH connection controls collapse to a compact session summary after connecting so the terminal receives the available height.

## Security and compatibility

- SSH passwords, private-key passphrases, and jump-host credentials remain only in live renderer memory and are never added to persisted UI state.
- Existing authenticated Pod Terminal and Node SSH WebSocket protocols are unchanged.
- Cluster removal and application shutdown retain ownership of session cleanup.

## Documentation and release contract

- Help now reads the packaged application version dynamically instead of containing a stale hardcoded value.
- English and Russian README files, architecture, security, migration status, changelog, and release checks are synchronized for 2.9.1.
- The Node-only ownership contract remains **Node 52 / Python 0**.

This remains a Node-only release: production packages do not include Python/FastAPI, PyInstaller, or a bundled `kubectl`.
