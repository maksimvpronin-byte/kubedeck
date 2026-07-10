# KubeDeck 2.0.6 — Regression Checklist

Дата проверки: ____________________  
Проверяющий: ____________________  
Коммит: ____________________  
Portable: `KubeDeck-Portable-2.0.6-x64.exe`

## 1. Автоматические проверки

- [ ] `npm.cmd run verify:node-only` проходит.
- [ ] `npm.cmd run verify:release` проходит.
- [ ] TypeScript typecheck проходит.
- [ ] Desktop/Vite build проходит.
- [ ] Gateway tests: fail `0`, cancelled `0`.
- [ ] Portable build проходит.
- [ ] `/migration/status`: `Node 49 / Python 0`, mode `node-only`.

## 2. Runtime и упаковка

- [ ] Portable запускается без установленного Python.
- [ ] В диспетчере задач нет `python.exe`, `pythonw.exe`, backend executable.
- [ ] В release нет `kubectl.exe`.
- [ ] В release нет `resources/backend`.
- [ ] В release нет `python*.dll`.
- [ ] Системный `kubectl` определяется корректно.
- [ ] Настроенный пользовательский путь к kubectl работает.

## 3. Кластеры и настройки

- [ ] Импорт kubeconfig работает.
- [ ] Переименование кластера работает.
- [ ] Переключение между кластерами работает.
- [ ] Недоступный кластер отображается корректно.
- [ ] После восстановления кластер обновляется без перезапуска приложения.
- [ ] Namespace selector сохраняет выбранное состояние.
- [ ] Settings сохраняются и показывают подтверждение.

## 4. Ресурсы

- [ ] Pods открываются и обновляются.
- [ ] Deployments открываются и обновляются.
- [ ] Services открываются и обновляются.
- [ ] Nodes открываются и обновляются.
- [ ] Namespaces открываются.
- [ ] Events отображаются.
- [ ] CRD definitions отображаются read-only.
- [ ] CRD instances открываются и редактируются.
- [ ] Resource Watch обновляет таблицы без ручного refresh.
- [ ] При недоступном кластере старые cached rows не выдаются как актуальные.

## 5. Детали и YAML

- [ ] Summary отображается.
- [ ] Describe отображается.
- [ ] Events ресурса отображаются.
- [ ] Related Resources отображаются.
- [ ] YAML viewer работает.
- [ ] YAML editor выполняет dry-run.
- [ ] Diff отображается корректно.
- [ ] Apply выполняется после подтверждения.
- [ ] Secret values маскируются и скрываются автоматически.

## 6. Операции

- [ ] Delete работает с подтверждением.
- [ ] Bulk delete не блокирует modal длительным `Deleting...`.
- [ ] Pod restart работает.
- [ ] Deployment redeploy работает.
- [ ] Scale работает.
- [ ] Node cordon/uncordon работает.
- [ ] Node drain показывает затрагиваемые Pods и работает.
- [ ] Dangerous action confirmation показывает правильный кластер и ресурс.

## 7. Логи и интерактивные сессии

- [ ] Pod logs открываются.
- [ ] Follow работает.
- [ ] Previous logs работают.
- [ ] Deployment logs объединяют Pods.
- [ ] Download logs работает.
- [ ] Pod Terminal принимает ввод и resize.
- [ ] Node SSH работает с паролем.
- [ ] Node SSH работает с private key.
- [ ] Jump host работает.
- [ ] Port Forward работает для Pod.
- [ ] Port Forward работает для Service.
- [ ] Port Forward работает для Deployment.
- [ ] Закрытие KubeDeck завершает Terminal, SSH, Watch и Port Forward процессы.

## 8. Problems, Search и LLM

- [ ] Problems отображает Pod/Deployment/Event/Node/PVC проблемы.
- [ ] Partial source error не ломает весь Problems dashboard.
- [ ] Global Search ищет по имени.
- [ ] Global Search ищет по label и namespace.
- [ ] Global Search находит Node и CRD instances.
- [ ] LLM Test connection работает.
- [ ] Preview prompt не содержит Secret values.
- [ ] Analyze resource возвращает результат.
- [ ] API key и LLM payload не попадают в логи.

## 9. UI regression

- [ ] Узкое окно не скрывает основные действия.
- [ ] Кнопки соответствуют общему стилю приложения.
- [ ] Drawer и modal имеют корректный scroll.
- [ ] RU интерфейс не содержит повреждённых символов.
- [ ] EN интерфейс отображается корректно.
- [ ] Dark/light/system theme работают.

## 10. Итог

- [ ] Блокирующих дефектов нет.
- [ ] Некритичные дефекты записаны отдельными задачами.
- [ ] KubeDeck `2.0.6` принят как стабильный релиз.

Комментарий:

```text

```
