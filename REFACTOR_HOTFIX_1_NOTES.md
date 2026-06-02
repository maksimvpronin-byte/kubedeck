# KubeDeck refactor hotfix 1

Fixes a broken extraction artifact in `apps/desktop/src/renderer/App.tsx` where the old inline `NamespaceSelector` and `CommandPalette` component bodies were partially left behind as anonymous `: { ... }) { ... }` blocks.

The components are now imported from:

- `apps/desktop/src/renderer/components/NamespaceSelector.tsx`
- `apps/desktop/src/renderer/components/CommandPalette.tsx`

This patch removes the duplicate broken inline blocks from `App.tsx`.
