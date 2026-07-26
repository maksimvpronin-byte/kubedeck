# KubeDeck 2.8.1 — план цвета переходных состояний Kubernetes

Статус: запланировано.

## Цель

Добавить в KubeDeck отдельную визуальную семантику для нормальных переходных
состояний Kubernetes: объект ещё не готов, но подтверждённой ошибки нет.

Сейчас интерфейс уверенно различает:

- зелёный — успешное и корректное состояние;
- красный — ошибка, отказ или деградация.

Между ними нужен янтарный `pending`-тон для ожидания, запуска, завершения,
масштабирования и reconciliation. Он должен сообщать «процесс ещё идёт», а не
«объект сломан».

## Семантическая модель 2.8.1

| Тон | Значение | Примеры |
|---|---|---|
| `success` | объект достиг ожидаемого состояния | `Running + Ready`, `Available`, `Succeeded`, `Complete` |
| `pending` | допустимый переход, результат ещё не достигнут | `Pending`, `ContainerCreating`, `PodInitializing`, `Terminating`, `Progressing`, `Reconciling`, `Scaling` |
| `danger` | подтверждённый сбой или деградация | `Failed`, `CrashLoopBackOff`, `ImagePullBackOff`, `ErrImagePull`, `OOMKilled`, `Evicted`, `DeadlineExceeded` |
| `neutral` | состояние не оценено или не требует акцента | пустое значение, `Unknown` без диагностированной ошибки, отключённая возможность |

`pending` не является более слабой ошибкой. Это отдельный нормальный этап
жизненного цикла объекта.

## Подтверждённый baseline

- В theme contract уже есть янтарные `--warning-bg`, `--warning-border` и
  `--warning-text`.
- Container state `waiting` уже использует янтарный цвет.
- `Pending`, `Terminating`, `waiting` и `cordon` частично классифицируются как
  `warning`.
- Любой container state `terminated` в summary сейчас может стать красным даже
  при успешном завершении.
- Часть компонентов выбирает tone локальными regex и условными выражениями.
- Единого общего классификатора Kubernetes-состояний для таблицы, drawer и
  summary пока нет.

## Границы патча 2.8.1

В патч входят только:

- семантический tone `pending`;
- единая минимальная классификация известных Kubernetes phase/reason/status;
- применение классификации в resource table, summary и container indicators;
- согласованное отображение во всех существующих темах;
- renderer contracts и ручной smoke.

Не входят:

- изменение backend-normalizers или Kubernetes API;
- новый status engine;
- изменение Problems severity;
- новые иконки или анимации;
- переписывание таблицы ресурсов;
- автоматический прогноз времени ожидания;
- замена всех информационных оттенков приложения.

## Цветовое решение

Использовать существующую янтарную палитру как основу переходного состояния:

```css
--pending-bg: var(--warning-bg);
--pending-border: var(--warning-border);
--pending-text: var(--warning-text);
```

На первом этапе не добавлять новые RGB-значения для каждой темы. Существующие
warning-токены уже имеют нужный контраст в Midnight, Nord, Forest, Teal, Plum,
Mocha, Light и System.

Отдельные `pending`-алиасы нужны для семантики: последующая настройка оттенка не
должна требовать поиска всех мест, где ожидание ошибочно связано с `warning`.

## Единая классификация

Добавить один небольшой renderer helper, возвращающий:

```ts
type KubernetesStatusTone = "success" | "pending" | "danger" | "neutral";
```

Классификация должна учитывать нормализованные `phase`, `status`, container
`state` и `reason`.

### `success`

- `Running`, только если readiness подтверждён там, где он доступен;
- `Ready`;
- `Available`;
- `Succeeded`;
- `Complete` / `Completed`.

### `pending`

- `Pending`;
- `ContainerCreating`;
- `PodInitializing`;
- `Terminating`;
- `Progressing`;
- `Reconciling`;
- `Scaling`;
- `Updating`;
- `Waiting`, если reason не входит в error-набор;
- `Running`, если объект ещё не Ready;
- успешный container termination с exit code `0`.

### `danger`

- `Failed`;
- `CrashLoopBackOff`;
- `ImagePullBackOff`;
- `ErrImagePull`;
- `CreateContainerError`;
- `RunContainerError`;
- `OOMKilled`;
- `Evicted`;
- `DeadlineExceeded`;
- container termination с ненулевым exit code;
- `NotReady`, если состояние не является кратким ожидаемым переходом,
  определённым данными объекта.

### `neutral`

- отсутствующий status;
- неизвестное значение, для которого нет подтверждённой ошибки;
- `Unknown` без error reason.

Не использовать правило «всё неизвестное красное». Новое состояние Kubernetes
не должно автоматически выглядеть аварийным.

## Применение в интерфейсе

### Resource table

- Phase/status badge или текст получает общий tone.
- `Pending` и `Terminating` отображаются янтарным.
- `Running + Ready` отображается зелёным.
- `Running`, но не Ready, отображается янтарным.
- Известные failure reasons отображаются красным.

### Container indicators

- `ready` — зелёный;
- `running`, но ещё не ready — янтарный;
- `waiting` без failure reason — янтарный;
- `waiting` с `CrashLoopBackOff`, image pull или container error — красный;
- `terminated` с exit code `0` — зелёный или нейтральный согласно контексту;
- `terminated` с ненулевым exit code — красный;
- неизвестное состояние — нейтральный.

### Resource summary и drawer

- Использовать тот же helper, что и таблица.
- Не поддерживать отдельные расходящиеся regex для одинаковых состояний.
- Текстовые причины и сообщения Kubernetes сохраняются без изменения.

### Async actions

`pending` у Kubernetes-объекта не смешивать с временной анимацией кнопки
`AsyncActionButton`. Кнопка может использовать тот же цветовой token, но её
phase и lifecycle остаются отдельными.

## Доступность

- Цвет не должен быть единственным носителем смысла: status/reason остаётся
  видимым текстом.
- `pending`, `success` и `danger` должны различаться не только hue, но и
  достаточным контрастом текста и границы.
- Проверить Light и все тёмные темы.
- Не добавлять постоянное мигание или пульсацию.
- Существующий spinner допустим только для действия пользователя, которое
  действительно выполняется.

## Контракты

- [ ] `Pending`, `ContainerCreating` и `Terminating` получают tone `pending`.
- [ ] `Progressing=True` без failure reason получает tone `pending`.
- [ ] `Running + Ready` получает tone `success`.
- [ ] `Running + NotReady` получает tone `pending`.
- [ ] `CrashLoopBackOff`, `ImagePullBackOff` и `ErrImagePull` получают tone `danger`.
- [ ] `terminated(exitCode=0)` не получает tone `danger`.
- [ ] `terminated(exitCode!=0)` получает tone `danger`.
- [ ] Неизвестное состояние получает tone `neutral`, а не `danger`.
- [ ] Table, summary и drawer используют один классификатор.
- [ ] Все темы предоставляют `pending` token contract.
- [ ] Цвет сопровождается видимым status/reason.

## Ручной smoke

- [ ] Создать Pod с образом, который загружается несколько секунд: `Pending` и
  `ContainerCreating` янтарные, после readiness становятся зелёными.
- [ ] Удалить Pod: `Terminating` янтарный до исчезновения строки.
- [ ] Выполнить rollout Deployment: `Progressing` янтарный, `Available` зелёный.
- [ ] Проверить Pod с `CrashLoopBackOff`: состояние красное.
- [ ] Проверить Pod с `ImagePullBackOff`: состояние красное.
- [ ] Проверить успешно завершённый Job: `Complete`/`Succeeded` не красные.
- [ ] Проверить Job с ненулевым exit code: состояние красное.
- [ ] Повторить основные сценарии в Midnight, Nord и Light.
- [ ] Убедиться, что status одинаков в таблице и resource drawer.

## Regression gate

- [ ] `npm run lint`.
- [ ] `npm run format:check`.
- [ ] `npm run test:renderer`.
- [ ] `npm run typecheck`.
- [ ] `npm run build`.
- [ ] `npm --workspace apps/desktop run test:gateway`.
- [ ] `npm run verify:release` после обновления release metadata до 2.8.1.
- [ ] `git diff --check`.

## Критерии приёмки 2.8.1

- [ ] Нормальное ожидание больше не выглядит ошибкой.
- [ ] Зелёный означает подтверждённую готовность или успешное завершение.
- [ ] Красный используется только при подтверждённом failure/degradation.
- [ ] Переходные состояния используют единый янтарный `pending`-тон.
- [ ] Table, summary, drawer и container indicators не расходятся по семантике.
- [ ] Неизвестные новые Kubernetes-состояния не становятся красными автоматически.
- [ ] Все темы сохраняют читаемость и контраст.
- [ ] Новые зависимости и архитектурные слои не добавлены.
