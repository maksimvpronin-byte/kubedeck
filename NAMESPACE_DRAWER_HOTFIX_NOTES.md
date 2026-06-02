# KubeDeck namespace refresh drawer hotfix

Fixes a UI issue where the resource drawer closed after background namespace refresh.

Root cause: namespace polling returned a new selectedNamespaces array even when the selected namespace still existed. React treated it as a state change and App.tsx cleared selectedPod.

Change:
- App.tsx now keeps the previous selectedNamespaces reference if the effective namespace selection did not change.
- If the selected namespace was deleted, selection still safely resets to All namespaces.
