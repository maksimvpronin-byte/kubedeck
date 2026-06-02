# KubeDeck 1.0.2 UI Timer Hotfix Plan

Version 1.0.2 is a small UI hotfix after the 1.0.1 stabilization release.

## Goal

Keep resource polling safe while making visible time counters feel live.

## Scope

- Do not increase Kubernetes API polling frequency.
- Keep normal resource polling controlled by `refreshIntervalSeconds`.
- Add a frontend-only clock that ticks every second.
- Recalculate elapsed UI values from already loaded timestamps.

## Implemented

- Added `useUiClock()` for local one-second UI ticks.
- Added shared time helpers in `utils/time.ts`.
- Resource table `createdAt`/Age columns now update every second locally.
- Drawer summary `Age` now updates every second locally.
- Drawer event timestamps now render as live `ago` values while keeping the raw timestamp as a tooltip.

## Explicit non-goals

- No `kubectl get -w` yet.
- No backend resource watch cache yet.
- No WebSocket state streaming for all resource lists yet.
- No one-second Kubernetes polling.
