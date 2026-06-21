# KubeDeck 2.0.0-alpha.1 — Node Gateway foundation

This patch introduces the first Node-owned backend boundary without removing Python.

## Included

- Node HTTP Gateway inside the Electron main process.
- Public Node-owned `GET /health`.
- Authenticated Node-owned `GET /migration/status`.
- Transparent HTTP proxy for the remaining 46 HTTP contracts.
- Transparent TCP/WebSocket upgrade proxy for the existing 3 WebSocket contracts.
- Session-token and Origin validation in the Gateway.
- Explicit registry for all 49 existing backend contracts.
- Contract test based on the built-in Node test runner.
- Version bump to `2.0.0-alpha.1`.

## Ownership after the patch

- Node: 1 existing route (`GET /health`).
- Python: 48 existing routes.
- New Node diagnostic route: `GET /migration/status`.

## Important

Python/FastAPI and the packaged backend executable are intentionally retained in Alpha 1.
No React screen or Kubernetes business feature is migrated in this patch.
