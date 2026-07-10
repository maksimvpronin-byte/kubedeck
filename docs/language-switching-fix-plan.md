# Language Switching Fix Plan

План для включения полноценного переключения языков в KubeDeck. Цель: режимы `system`, `ru` и `en` должны менять интерфейс предсказуемо, сохраняться в настройках и корректно отражаться в документе.

## Текущая диагностика

- Тип языка уже описан как `system | ru | en` в renderer/backend types.
- Backend уже сохраняет и валидирует `settings.language`.
- Словари `ru.json` и `en.json` подключены через `createTranslator`.
- `App.tsx` строил `t()` только от сохраненного `config.settings.language`, поэтому выбор языка в Settings не давал preview до Save.
- `system` резолвился внутри `i18n.ts`, но не было общего resolver-а, `html lang` не обновлялся и не было реакции на событие `languagechange`.
- В Settings варианты `ru/en` были показаны сырыми значениями, без локализованных подписей.

## Целевое поведение

- `ru`: интерфейс всегда на русском.
- `en`: интерфейс всегда на английском.
- `system`: интерфейс выбирает `ru`, если системный язык начинается с `ru`, иначе `en`.
- При выборе языка в Settings интерфейс сразу показывает preview до Save.
- Если пользователь уходит из Settings без Save, preview сбрасывается к сохраненному языку.
- После Save язык сохраняется в config и переживает перезапуск.
- DOM получает корректные `html lang`, `data-language-preference` и `data-language`.

## Выполненный первый проход

- Добавлен `apps/desktop/src/renderer/utils/language.ts` с `resolveLanguage()` и `applyLanguagePreference()`.
- `i18n.ts` использует общий resolver.
- `App.tsx` получил `languagePreview`, пересчитывает `t()` от preview/saved/system и выставляет DOM language metadata.
- Для `system` добавлен listener на `window.languagechange`.
- `SettingsPanel.tsx` включает preview языка и сбрасывает его при unmount.
- В локали добавлены `settings.language.ru` и `settings.language.en`.

## Оставшиеся проверки вручную

- Открыть Settings и переключить `ru -> en -> system`: интерфейс должен меняться сразу.
- Не нажимать Save, выйти из Settings: язык должен вернуться к сохраненному.
- Нажать Save, перезапустить приложение: язык должен сохраниться.
- Проверить `document.documentElement.lang` для `ru/en/system`.
- Проверить LLM-вкладку: язык анализа должен соответствовать сохраненным settings после Save.

## Проверки

- `npm run typecheck`
- `npm run build`
- `npm --workspace apps/desktop run test:gateway`

## Журнал выполнения

- 2026-07-09: включен первый проход переключения языков: resolver, DOM metadata, preview в Settings, `languagechange` для system и локализованные подписи вариантов; проверки: `npm run typecheck`, `npm run build`, `npm --workspace apps/desktop run test:gateway`.
