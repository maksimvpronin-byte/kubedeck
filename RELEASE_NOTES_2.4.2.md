# KubeDeck 2.4.2 — Release Notes

Дата подготовки: 2026-07-16

KubeDeck 2.4.2 упрощает feedback группового удаления ресурсов. После успешного удаления таблица обновляется без отдельной зелёной completion-панели и кнопки `Close`. Релиз сохраняет Node-only runtime: Node 50 / Python 0.

## Bulk delete без лишнего окна

- После подтверждения удаления выбранные строки сохраняют понятное состояние `Terminating`.
- По завершении таблица перезагружается, а удалённые строки исчезают без `Bulk delete requested/completed` панели.
- Не добавляется новая toast-система или отдельный success result.
- Успешно удалённый выбранный ресурс закрывается в drawer.

## Надёжная обработка ошибок

- Partial и full failure показываются только в существующем копируемом ErrorPanel.
- ErrorPanel сохраняет counts, resource identity и очищенные failure details без Secret data.
- Reload выполняется после всех попыток, включая полный failure, поэтому failed rows не остаются в `Terminating`.
- Failed selected row восстанавливается и остаётся доступной для диагностики.

## Node actions

- Drain, Cordon и Uncordon используют отдельный `nodeActionMessage`.
- Их progress/success status и кнопка `Close` сохранены.
- Ошибки node actions продолжают отображаться через ErrorPanel.

## Проверка

Автоматический gate включает lint, format check, 21 renderer contract, TypeScript typecheck, production build и 70 Gateway contracts. Release contract проверяет Node 50 / Python 0 и одинаковую версию artifacts для macOS и Windows.

## Artifacts

- Windows x64: `apps\desktop\release\KubeDeck-Portable-2.4.2-x64.exe`;
- macOS arm64: `apps/desktop/release/KubeDeck-2.4.2-arm64.dmg` и `.zip`.
