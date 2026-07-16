# KubeDeck 2.4.3 — Release Notes

Дата подготовки: 2026-07-16

KubeDeck 2.4.3 исправляет навигацию между кластерами и ресурсами. Namespace-выбор больше не переносится в другой кластер, а resource drawer сразу показывает согласованные данные выбранного объекта. Релиз сохраняет Node-only runtime: Node 50 / Python 0.

## Namespaces отдельно для каждого кластера

- Одиночный и множественный выбор сохраняются по стабильному `clusterId`.
- Новый кластер открывается с безопасным scope `all`, а ранее посещённый восстанавливает собственный выбор.
- Переход на cluster-scoped ресурс временно использует `_cluster`, не затирая namespaced-память.
- Удалённые namespaces фильтруются; если сохранённых значений не осталось, используется `all`.
- Временный пустой ответ namespace list не уничтожает сохранённую настройку.
- Поздние ответы предыдущего кластера игнорируются request-sequence guard.
- Нативный системный список кластеров заменён тематизированным меню в стиле Namespace Selector.

## Корректное переключение resource drawer

- Cluster, resource и row объединены в одну атомарную выбранную цель.
- При переходе Secret → Pod или между другими ресурсами header, Summary и actions получают одну согласованную identity.
- Старый drawer немедленно скрывается при смене cluster или resource tab.
- YAML, Describe, Events, Related и Logs не отображают snapshot предыдущего объекта во время reset.
- Ответы предыдущего объекта отклоняются существующими AbortController и request-generation guards.
- Auto-refresh той же identity продолжает сохранять активную вкладку и локальное состояние.

## Проверка

Автоматический gate включает lint, format check, 24 renderer contracts, TypeScript typecheck, production build и Gateway contracts. Release contract проверяет Node 50 / Python 0 и одинаковую версию artifacts для macOS и Windows.

## Artifacts

- Windows x64: `apps\desktop\release\KubeDeck-Portable-2.4.3-x64.exe`;
- macOS arm64: `apps/desktop/release/KubeDeck-2.4.3-arm64.dmg` и `.zip`.
