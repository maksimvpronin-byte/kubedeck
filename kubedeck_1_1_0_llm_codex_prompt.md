# Codex task: KubeDeck 1.1.0 — Local LLM integration

Repository:
https://github.com/maksimvpronin-byte/kubedeck

You are working in the existing KubeDeck project. Do not create a new project folder. Keep current architecture and style.

## Product context

KubeDeck is a Windows desktop Kubernetes IDE:
- Electron + React + TypeScript frontend
- Python FastAPI backend
- local backend on 127.0.0.1
- system kubectl as Kubernetes transport

Keep existing UI style, i18n, settings/config flow, drawer tabs, API client patterns, backend route style, error handling, and build scripts.

## Graph navigation hint

This repo may already contain Graphify output:

- graphify-out/graph.html
- graphify-out/graph.json
- graphify-out/GRAPH_REPORT.md

Use these files only as navigation hints. Always verify against current source code before editing.

Known graph hints:
- ApiClient is central for frontend/backend API calls.
- Resource drawer/table areas are central UI surfaces.
- Settings/config modules are important.
- Backend routes may be split across core/resource route modules.
- Related resources/problems/diagnostics areas may help with LLM context.

If graph files are missing, inspect source normally.

## Version

Bump version to `1.1.0` everywhere it is declared/displayed:
- package.json
- package-lock.json if needed
- desktop package metadata if present
- README.md
- CHANGELOG.md
- scripts/build metadata if version is embedded
- UI/About/backend constants if present

Do not bundle kubectl.

## Main feature

Add a new `LLM` tab/button inside the existing resource detail drawer next to Summary/YAML/Describe/Events/Related/Logs/etc.

The user opens a Kubernetes resource, goes to LLM tab, clicks `Analyze resource`, and KubeDeck sends sanitized resource context to a local LLM API. The LLM returns human-readable diagnostics:
- what the resource is
- health/problem summary
- likely causes
- recommended next checks
- suggested kubectl commands
- risk/severity when applicable

Do not run analysis automatically. Only run after explicit user action.

## Provider

Implement only OpenAI-compatible local API for v1.1.0.

Provider value:
`openai_compatible`

Example base URLs:
- LM Studio: `http://127.0.0.1:1234/v1`
- Ollama OpenAI-compatible: `http://127.0.0.1:11434/v1`
- LocalAI/OpenWebUI compatible endpoints

Use Chat Completions:
`POST {baseUrl}/chat/completions`

Payload:
```json
{
  "model": "<model>",
  "messages": [
    {"role": "system", "content": "..."},
    {"role": "user", "content": "..."}
  ],
  "temperature": 0.2
}
```

Normalize trailing slashes and `/v1`. Respect timeout.

## Settings/config

Add LLM settings to existing config structure:

```json
{
  "llm": {
    "enabled": false,
    "provider": "openai_compatible",
    "baseUrl": "",
    "model": "",
    "apiKey": "",
    "temperature": 0.2,
    "timeoutSeconds": 60,
    "maxContextChars": 60000
  }
}
```

Follow existing nesting if config is structured differently.

For v1.1.0 store `apiKey` in local config.json.
Requirements:
- mask token/API key in UI
- never log token in frontend/backend
- never include token in errors
- never return token from backend status/test endpoints
- send token only as `Authorization: Bearer <token>` to configured LLM endpoint
- if token is empty, do not send Authorization header
- add TODO for future Windows Credential Manager/encrypted storage, but do not implement it now

## Settings UI

Add Settings -> LLM section:
- Enable LLM
- Provider: OpenAI-compatible only
- API Base URL
- Model
- API Token/API Key
- Temperature
- Timeout seconds
- Max context chars
- Save
- Test connection

Save must show visible success/failure. Test connection must call backend and show clear result. Do not freeze UI.

## Backend API

Add LLM backend module if appropriate, e.g.:
- kubedeck_backend/llm/client.py
- kubedeck_backend/llm/context.py
- kubedeck_backend/llm/prompts.py

Add endpoints:

### GET /llm/status
Return enabled/configured/provider/baseUrl/model. Do not return apiKey.

### POST /llm/test
Test current or supplied config with minimal OpenAI-compatible request. Return structured success/failure. Do not return apiKey.

### POST /llm/analyze-resource
Input: cluster/context, kind, namespace, name, resource object, optional events/describe/log excerpts if available.

Backend must:
- sanitize context
- truncate to maxContextChars
- build prompt
- call local LLM
- return:

```json
{
  "answer": "...",
  "model": "...",
  "elapsedMs": 1234,
  "contextChars": 12345,
  "truncated": false
}
```

## Sanitization

Before sending anything to LLM, redact:
- Kubernetes Secret data/stringData
- decoded Secret values
- kubeconfig
- bearer tokens
- service account tokens
- passwords
- private keys
- Authorization headers

Mask values with keys containing:
TOKEN, PASSWORD, PASS, SECRET, KEY, CREDENTIAL, AUTH, BEARER, PRIVATE

Apply to env vars, annotations, labels if sensitive-looking, logs, YAML, config-like fields.

Use `<redacted>`. Mark truncation with `[TRUNCATED]`.

Never log full prompt or raw Kubernetes resource data.

## Resource context

Must work at least for Pods. Prefer generic resources if easy.

For Pods include:
- cluster
- namespace/name
- phase
- node
- pod IP
- owners
- labels
- restart counts
- container/init container statuses
- waiting/terminated reasons
- lastState
- readiness
- conditions
- recent events
- describe excerpt if available
- sanitized YAML
- current logs excerpt if available
- previous logs excerpt if available

For other resources include kind, namespace/name, sanitized labels/annotations, spec/status summary, conditions, events, related resources, sanitized YAML.

## Frontend LLM tab

If LLM is not configured:
Show empty state:
`LLM is not configured. Configure local LLM API in Settings.`
Add Settings link/button if current UI supports it.

If configured:
- show Analyze resource button
- loading state
- readable answer panel
- copy answer
- rerun analysis
- metadata: model, elapsed time, context size, truncated yes/no
- existing error style with copy details if available
- no UI freeze

Render answer as plain text or existing markdown-like rendering. Do not add heavy markdown dependency.

## Diagnostic prompt

System prompt:
You are a Kubernetes/SRE diagnostic assistant inside KubeDeck. Analyze only the provided Kubernetes context. Do not invent facts. Separate observed facts from hypotheses. Explain clearly and practically. Prioritize actionable checks. Mention dangerous actions clearly. Never ask for credentials. Never output secrets. If context is insufficient, say what is missing. Answer in current UI language if provided, otherwise Russian by default.

User prompt sections:
- RESOURCE IDENTITY
- HEALTH SUMMARY
- STATUS / CONDITIONS
- CONTAINERS
- EVENTS
- DESCRIBE EXCERPT
- LOGS EXCERPT
- YAML EXCERPT
- RELATED RESOURCES
- USER REQUEST

Default user request:
Analyze this Kubernetes resource and explain possible problems, causes, and next checks in human-readable language.

## i18n

Add RU/EN strings for:
LLM, Analyze resource, Rerun analysis, Copy answer, LLM is not configured, Configure LLM in Settings, Test connection, Connection successful, Connection failed, Model, API Base URL, API Token, Timeout, Max context size, Context was truncated, No LLM response, Enable LLM integration, Provider, Temperature, Save LLM settings, LLM settings saved, LLM settings save failed, Local LLM diagnostics, Analysis failed.

Do not hardcode English-only UI text.

## Errors

Handle clearly:
- LLM disabled
- base URL missing/invalid
- model missing
- timeout
- server unreachable
- HTTP non-2xx
- invalid response
- no message content

Never expose apiKey.

## Docs

Update README with Local LLM integration:
- OpenAI-compatible local APIs
- LM Studio URL example
- Ollama URL example
- token optional
- data-safety note

Update CHANGELOG 1.1.0:
- local LLM integration
- LLM Settings
- resource drawer LLM tab
- OpenAI-compatible API support
- sanitization/truncation
- test connection
- version bump

## Build/checks

Run available checks:
- npm run typecheck
- npm run build
- npm run package:win if supported in this environment
- backend tests/checks if present

If a check fails due to environment, document it.

## Constraints

Do not:
- redesign drawer/settings globally
- add cloud AI providers
- add chat history
- persist LLM analysis history
- auto-send resource data
- include decoded secrets
- bundle kubectl
- change kubectl-based architecture
- run npm ci unless clearly necessary
- reinstall/download dependencies unless necessary
- create a new versioned project folder

## Manual test

1. Start local OpenAI-compatible LLM server.
2. Open KubeDeck.
3. Settings -> LLM.
4. Enable LLM.
5. Set base URL, e.g. `http://127.0.0.1:1234/v1`.
6. Set model.
7. Leave token empty if server does not require auth.
8. Test connection.
9. Open cluster.
10. Open Pod with restarts/events.
11. Open LLM tab.
12. Click Analyze resource.
13. Confirm answer explains status, restart/events/logs if available, causes and next checks.
14. Confirm token is masked and absent from logs/errors.
15. Confirm decoded Secret values are not sent.

## Final response

When done, summarize:
- implemented changes
- important changed files
- version bump confirmation
- commands run and results
- manual test notes
- known limitations
