# KubeDeck 2.1.0 — Release Notes

Дата подготовки: 2026-07-10

KubeDeck 2.1.0 — Node-only architecture hardening release. Все 49 backend-контрактов остаются Node-owned; Python/FastAPI runtime и встроенный kubectl отсутствуют.

Актуальный desktop baseline: Electron 43.1.0, Chromium 150.0.7871.47 и Node 24.18.0. Для install/build tooling требуется Node.js 22.12+.

## Основные изменения

- актуализированы architecture, security, API и release документы;
- resource loading, watch lifecycle и preferences вынесены из `App.tsx`;
- крупный ResourceTable разделён на самостоятельные UI-области;
- theme tokens и base styles отделены от feature stylesheet;
- `@kubedeck/shared-types` стал общей renderer/main type boundary;
- удалён пустой `@kubedeck/ui` workspace;
- основной renderer chunk уменьшен примерно с 716 KB до 267 KB;
- редкие панели и PodDrawer загружаются отдельными chunks с loading/error fallback;
- включён Electron Chromium sandbox;
- navigation и Pod Shell IPC получили дополнительные guards.

## Проверка

Обязательный автоматический gate:

```bash
npm run typecheck
npm run build
npm --workspace apps/desktop run test:gateway
```

Platform packaging и ручной smoke фиксируются отдельно в `REGRESSION_CHECKLIST_2.1.0.md`.

## Artifacts

- Windows x64: `apps\desktop\release\KubeDeck-Portable-2.1.0-x64.exe`;
- macOS arm64: `apps/desktop/release/KubeDeck-2.1.0-arm64.dmg` и `.zip`.
