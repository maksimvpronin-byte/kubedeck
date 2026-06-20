# KubeDeck

KubeDeck вЂ” Windows desktop Kubernetes IDE.

РџСЂРѕРµРєС‚ РїСЂРµРґРЅР°Р·РЅР°С‡РµРЅ РґР»СЏ СѓРґРѕР±РЅРѕР№ СЂР°Р±РѕС‚С‹ СЃ Kubernetes-РєР»Р°СЃС‚РµСЂР°РјРё РёР· Windows-РїСЂРёР»РѕР¶РµРЅРёСЏ Р±РµР· РЅРµРѕР±С…РѕРґРёРјРѕСЃС‚Рё РІСЂСѓС‡РЅСѓСЋ Р·Р°РїСѓСЃРєР°С‚СЊ РґР»РёРЅРЅС‹Рµ `kubectl`-РєРѕРјР°РЅРґС‹.

РўРµРєСѓС‰Р°СЏ РІРµСЂСЃРёСЏ РїСЂРѕРµРєС‚Р°: **1.1.2**.

---

## РћСЃРЅРѕРІРЅР°СЏ РёРґРµСЏ

KubeDeck СЃРѕСЃС‚РѕРёС‚ РёР· РґРІСѓС… С‡Р°СЃС‚РµР№:

| Р§Р°СЃС‚СЊ | РўРµС…РЅРѕР»РѕРіРёРё | РќР°Р·РЅР°С‡РµРЅРёРµ |
|---|---|---|
| Desktop UI | Electron, React, TypeScript | РћРєРЅРѕ РїСЂРёР»РѕР¶РµРЅРёСЏ, РёРЅС‚РµСЂС„РµР№СЃ, С‚Р°Р±Р»РёС†С‹ СЂРµСЃСѓСЂСЃРѕРІ, drawer, YAML, Р»РѕРіРё |
| Backend | Python, FastAPI | РќРѕСЂРјР°Р»РёР·Р°С†РёСЏ РґР°РЅРЅС‹С… Kubernetes, health-check, Р»РѕРєР°Р»СЊРЅС‹Рµ API |
| Kubernetes CLI | kubectl | Р РµР°Р»СЊРЅРѕРµ РІР·Р°РёРјРѕРґРµР№СЃС‚РІРёРµ СЃ Kubernetes-РєР»Р°СЃС‚РµСЂР°РјРё |

Backend Р·Р°РїСѓСЃРєР°РµС‚СЃСЏ Р»РѕРєР°Р»СЊРЅРѕ РІРјРµСЃС‚Рµ СЃ desktop-РїСЂРёР»РѕР¶РµРЅРёРµРј Рё СЃР»СѓС€Р°РµС‚ С‚РѕР»СЊРєРѕ `127.0.0.1`.

---

## Р§С‚Рѕ СѓРјРµРµС‚ РїСЂРёР»РѕР¶РµРЅРёРµ

РќР° С‚РµРєСѓС‰РµРј СЌС‚Р°РїРµ KubeDeck СѓРјРµРµС‚:

- РёРјРїРѕСЂС‚РёСЂРѕРІР°С‚СЊ kubeconfig С‡РµСЂРµР· UI;
- С…СЂР°РЅРёС‚СЊ kubeconfig-С„Р°Р№Р»С‹ РІ `%APPDATA%\KubeDeck\kubeconfigs`;
- РїРѕРєР°Р·С‹РІР°С‚СЊ СЃРїРёСЃРѕРє РєР»Р°СЃС‚РµСЂРѕРІ/РєРѕРЅС‚РµРєСЃС‚РѕРІ;
- РїРµСЂРµРёРјРµРЅРѕРІС‹РІР°С‚СЊ РєР»Р°СЃС‚РµСЂС‹ РІ UI;
- РѕС‚РєСЂС‹РІР°С‚СЊ РїРѕСЃР»РµРґРЅРёР№ РІС‹Р±СЂР°РЅРЅС‹Р№ РєР»Р°СЃС‚РµСЂ;
- РІС‹Р±РёСЂР°С‚СЊ namespace;
- РїРѕРєР°Р·С‹РІР°С‚СЊ Kubernetes-СЂРµСЃСѓСЂСЃС‹:
  - Pods;
  - Deployments;
  - Services;
  - ConfigMaps;
  - Secrets;
  - Ingresses;
  - Jobs;
  - CronJobs;
  - StatefulSets;
  - DaemonSets;
  - PersistentVolumes;
  - PersistentVolumeClaims;
  - StorageClasses;
  - Nodes;
  - Namespaces;
  - ServiceAccounts;
  - RBAC resources;
  - Events;
  - CRD definitions;
  - CRD instances;
- РѕС‚РєСЂС‹РІР°С‚СЊ detail drawer СЂРµСЃСѓСЂСЃР°;
- СЃРјРѕС‚СЂРµС‚СЊ YAML СЂРµСЃСѓСЂСЃР°;
- СЂРµРґР°РєС‚РёСЂРѕРІР°С‚СЊ YAML СЃ dry-run/apply;
- СЃРјРѕС‚СЂРµС‚СЊ `kubectl describe`;
- СЃРјРѕС‚СЂРµС‚СЊ Events РїРѕ СЂРµСЃСѓСЂСЃСѓ;
- СЃРјРѕС‚СЂРµС‚СЊ Related resources;
- СЃРјРѕС‚СЂРµС‚СЊ Pod logs;
- СЃРјРѕС‚СЂРµС‚СЊ Deployment logs СЃСЂР°Р·Сѓ РїРѕ РІСЃРµРј Pod РІС‹Р±СЂР°РЅРЅРѕРіРѕ Deployment;
- РІС‹РїРѕР»РЅСЏС‚СЊ Pod terminal С‡РµСЂРµР· `kubectl exec`;
- Р·Р°РїСѓСЃРєР°С‚СЊ port-forward;
- СЃРјРѕС‚СЂРµС‚СЊ Problems dashboard;
- СЃРјРѕС‚СЂРµС‚СЊ Secrets СЃ reveal/copy/auto-hide;
- РІС‹РїРѕР»РЅСЏС‚СЊ РѕРїР°СЃРЅС‹Рµ РґРµР№СЃС‚РІРёСЏ СЃ РїРѕРґС‚РІРµСЂР¶РґРµРЅРёСЏРјРё;
- РІС‹РїРѕР»РЅСЏС‚СЊ bulk delete;
- РёСЃРїРѕР»СЊР·РѕРІР°С‚СЊ RU/EN РёРЅС‚РµСЂС„РµР№СЃ;
- РёСЃРїРѕР»СЊР·РѕРІР°С‚СЊ dark/light/system theme;
- Р°РЅР°Р»РёР·РёСЂРѕРІР°С‚СЊ СЂРµСЃСѓСЂСЃС‹ С‡РµСЂРµР· Р»РѕРєР°Р»СЊРЅС‹Р№ OpenAI-compatible LLM API.

## Local LLM diagnostics

KubeDeck 1.1.2 can connect to a local OpenAI-compatible Chat Completions API and add manual diagnostics in the resource drawer LLM tab.

- Supported provider for 1.1.2: `openai_compatible`.
- LM Studio example: `http://127.0.0.1:1234/v1`.
- Ollama OpenAI-compatible example: `http://127.0.0.1:11434/v1`.
- API token is optional. If it is empty, KubeDeck does not send an `Authorization` header.
- Settings are stored locally in `%APPDATA%\KubeDeck\config.json`; API keys are masked in UI.
- Resource context is sanitized and truncated before being sent to the configured local endpoint. Kubernetes Secret data, bearer tokens, passwords, private keys and sensitive key-like fields are redacted.
- Analysis never runs automatically. Open a resource, select the LLM tab, and click `Analyze resource`.

---

# Р‘С‹СЃС‚СЂС‹Р№ СЃС‚Р°СЂС‚ РґР»СЏ Windows

Р­С‚РѕС‚ РІР°СЂРёР°РЅС‚ РїСЂРµРґРЅР°Р·РЅР°С‡РµРЅ РґР»СЏ С‡РёСЃС‚РѕР№ Windows-РјР°С€РёРЅС‹.

РЎРєСЂРёРїС‚ СЃР°Рј РїРѕСЃС‚Р°РІРёС‚ РЅСѓР¶РЅС‹Рµ Р·Р°РІРёСЃРёРјРѕСЃС‚Рё, СЃРєР°С‡Р°РµС‚ РїСЂРѕРµРєС‚ Рё СЃРѕР±РµСЂС‘С‚ portable `.exe`.

## 1. РћС‚РєСЂРѕР№ PowerShell РѕС‚ РёРјРµРЅРё Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂР°

РќР°Р¶РјРё:

```text
Start в†’ PowerShell в†’ Run as administrator
```

## 2. Р’С‹РїРѕР»РЅРё РѕРґРЅСѓ РєРѕРјР°РЅРґСѓ

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
$Script = "$env:TEMP\kubedeck-setup.ps1"
Invoke-WebRequest -UseBasicParsing "https://raw.githubusercontent.com/maksimvpronin-byte/kubedeck/main/scripts/setup-windows.ps1" -OutFile $Script
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Script -Clone -Build
```

## 3. Р§С‚Рѕ СЃРґРµР»Р°РµС‚ СЃРєСЂРёРїС‚

РЎРєСЂРёРїС‚ РІС‹РїРѕР»РЅРёС‚ РїРѕР»РЅС‹Р№ bootstrap:

1. РџСЂРѕРІРµСЂРёС‚, С‡С‚Рѕ Р·Р°РїСѓСЃРє РёРґС‘С‚ РЅР° Windows.
2. РџСЂРѕРІРµСЂРёС‚ РЅР°Р»РёС‡РёРµ `winget`.
3. РЈСЃС‚Р°РЅРѕРІРёС‚ РЅРµРґРѕСЃС‚Р°СЋС‰РёРµ РїСЂРѕРіСЂР°РјРјС‹:
   - Git;
   - Node.js LTS;
   - Python 3.11;
   - kubectl.
4. РЎРєР»РѕРЅРёСЂСѓРµС‚ СЂРµРїРѕР·РёС‚РѕСЂРёР№ РІ:

   ```text
   %USERPROFILE%\KubeDeck
   ```

5. РЈСЃС‚Р°РЅРѕРІРёС‚ npm-Р·Р°РІРёСЃРёРјРѕСЃС‚Рё.
6. РЈСЃС‚Р°РЅРѕРІРёС‚ Python-Р·Р°РІРёСЃРёРјРѕСЃС‚Рё backend.
7. Р—Р°РїСѓСЃС‚РёС‚ РїСЂРѕРІРµСЂРєСѓ РїСЂРѕРµРєС‚Р°.
8. РЎРѕР±РµСЂС‘С‚ portable-РІРµСЂСЃРёСЋ.

## 4. Р“РґРµ Р±СѓРґРµС‚ РіРѕС‚РѕРІС‹Р№ С„Р°Р№Р»

РџРѕСЃР»Рµ СѓСЃРїРµС€РЅРѕР№ СЃР±РѕСЂРєРё portable-С„Р°Р№Р» Р±СѓРґРµС‚ Р·РґРµСЃСЊ:

```text
%USERPROFILE%\KubeDeck\apps\desktop\release\KubeDeck-Portable-1.1.2-x64.exe
```

Р—Р°РїСѓСЃС‚Рё РµРіРѕ РґРІРѕР№РЅС‹Рј РєР»РёРєРѕРј.

---

# Р•СЃР»Рё РїСЂРѕРµРєС‚ СѓР¶Рµ СЃРєР°С‡Р°РЅ

Р•СЃР»Рё СЂРµРїРѕР·РёС‚РѕСЂРёР№ СѓР¶Рµ РµСЃС‚СЊ РЅР° РґРёСЃРєРµ, РЅР°РїСЂРёРјРµСЂ:

```text
C:\Users\Fidel\Kubedeck-agent 1.1.2
```

РћС‚РєСЂРѕР№ PowerShell РІ СЌС‚РѕР№ РїР°РїРєРµ Рё РІС‹РїРѕР»РЅРё:

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1 -Build
```

РЎРєСЂРёРїС‚ РЅРµ Р±СѓРґРµС‚ Р·Р°РЅРѕРІРѕ РєР»РѕРЅРёСЂРѕРІР°С‚СЊ РїСЂРѕРµРєС‚. РћРЅ РёСЃРїРѕР»СЊР·СѓРµС‚ С‚РµРєСѓС‰СѓСЋ РїР°РїРєСѓ.

---

# РўСЂРµР±РѕРІР°РЅРёСЏ

РњРёРЅРёРјР°Р»СЊРЅРѕ РЅСѓР¶РЅС‹:

| РљРѕРјРїРѕРЅРµРЅС‚ | Р’РµСЂСЃРёСЏ | Р—Р°С‡РµРј |
|---|---:|---|
| Windows | 10/11 x64 | С†РµР»РµРІР°СЏ РћРЎ |
| PowerShell | 5.1+ | Р·Р°РїСѓСЃРє СЃРєСЂРёРїС‚РѕРІ |
| winget | Р°РєС‚СѓР°Р»СЊРЅС‹Р№ | Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєР°СЏ СѓСЃС‚Р°РЅРѕРІРєР° Р·Р°РІРёСЃРёРјРѕСЃС‚РµР№ |
| Git | Р°РєС‚СѓР°Р»СЊРЅС‹Р№ | РєР»РѕРЅРёСЂРѕРІР°РЅРёРµ СЂРµРїРѕР·РёС‚РѕСЂРёСЏ |
| Node.js | 20+ / LTS | СЃР±РѕСЂРєР° desktop-С‡Р°СЃС‚Рё |
| npm | РІРјРµСЃС‚Рµ СЃ Node.js | СѓСЃС‚Р°РЅРѕРІРєР° JS-Р·Р°РІРёСЃРёРјРѕСЃС‚РµР№ |
| Python | 3.11+ | backend |
| Python Launcher | `py` | Р·Р°РїСѓСЃРє Python РёР· СЃРєСЂРёРїС‚РѕРІ |
| kubectl | Р°РєС‚СѓР°Р»СЊРЅС‹Р№ | РґРѕСЃС‚СѓРї Рє Kubernetes |

РџСЂРѕРІРµСЂРєР° РІСЂСѓС‡РЅСѓСЋ:

```powershell
git --version
node --version
npm --version
py -3 --version
kubectl version --client
```

---

# Р’Р°Р¶РЅРѕРµ РїСЂРѕ kubectl

KubeDeck **РЅРµ РєР»Р°РґС‘С‚ `kubectl.exe` РІРЅСѓС‚СЂСЊ portable-СЃР±РѕСЂРєРё**.

Р­С‚Рѕ СЃРґРµР»Р°РЅРѕ СЃРїРµС†РёР°Р»СЊРЅРѕ.

РџСЂРёР»РѕР¶РµРЅРёРµ РёСЃРїРѕР»СЊР·СѓРµС‚:

1. `kubectl` РёР· СЃРёСЃС‚РµРјРЅРѕРіРѕ `PATH`; РёР»Рё
2. РїСѓС‚СЊ РґРѕ `kubectl.exe`, СѓРєР°Р·Р°РЅРЅС‹Р№ РІ Settings РїСЂРёР»РѕР¶РµРЅРёСЏ.

РЈСЃС‚Р°РЅРѕРІРёС‚СЊ kubectl РІСЂСѓС‡РЅСѓСЋ РјРѕР¶РЅРѕ С‚Р°Рє:

```powershell
winget install -e --id Kubernetes.kubectl
```

РџСЂРѕРІРµСЂРёС‚СЊ:

```powershell
kubectl version --client
```

Р•СЃР»Рё `kubectl` Р»РµР¶РёС‚ РЅРµ РІ `PATH`, СѓРєР°Р¶Рё РїРѕР»РЅС‹Р№ РїСѓС‚СЊ РІ РЅР°СЃС‚СЂРѕР№РєР°С… KubeDeck, РЅР°РїСЂРёРјРµСЂ:

```text
C:\Tools\kubectl\kubectl.exe
```

---

# РџРµСЂРІС‹Р№ Р·Р°РїСѓСЃРє

РџРѕСЃР»Рµ Р·Р°РїСѓСЃРєР° portable `.exe`:

1. РћС‚РєСЂРѕР№ Settings.
2. РџСЂРѕРІРµСЂСЊ РїСѓС‚СЊ РґРѕ `kubectl`.
3. РРјРїРѕСЂС‚РёСЂСѓР№ kubeconfig.
4. Р’С‹Р±РµСЂРё РєР»Р°СЃС‚РµСЂ/context.
5. Р’С‹Р±РµСЂРё namespace.
6. РџСЂРѕРІРµСЂСЊ РѕСЃРЅРѕРІРЅС‹Рµ СЂР°Р·РґРµР»С‹:
   - Pods;
   - Deployments;
   - Services;
   - Events;
   - Problems.

---

# Р“РґРµ Р»РµР¶Р°С‚ РЅР°СЃС‚СЂРѕР№РєРё Рё Р»РѕРіРё

KubeDeck С…СЂР°РЅРёС‚ РїРѕР»СЊР·РѕРІР°С‚РµР»СЊСЃРєРёРµ РґР°РЅРЅС‹Рµ Р·РґРµСЃСЊ:

```text
%APPDATA%\KubeDeck
```

РћСЃРЅРѕРІРЅС‹Рµ С„Р°Р№Р»С‹ Рё РїР°РїРєРё:

```text
%APPDATA%\KubeDeck\
  config.json
  kubeconfigs\
  logs\
    desktop.log
    backend.log
    kubectl.log
```

РќР°Р·РЅР°С‡РµРЅРёРµ:

| РџСѓС‚СЊ | РќР°Р·РЅР°С‡РµРЅРёРµ |
|---|---|
| `config.json` | РЅР°СЃС‚СЂРѕР№РєРё РїСЂРёР»РѕР¶РµРЅРёСЏ |
| `kubeconfigs\` | РёРјРїРѕСЂС‚РёСЂРѕРІР°РЅРЅС‹Рµ kubeconfig-С„Р°Р№Р»С‹ |
| `logs\desktop.log` | Р»РѕРіРё Electron/Desktop |
| `logs\backend.log` | Р»РѕРіРё Python backend |
| `logs\kubectl.log` | РґРёР°РіРЅРѕСЃС‚РёС‡РµСЃРєРёРµ Р»РѕРіРё kubectl-РІС‹Р·РѕРІРѕРІ |

---

# РЎР±РѕСЂРєР° portable РІСЂСѓС‡РЅСѓСЋ

РР· РєРѕСЂРЅСЏ РїСЂРѕРµРєС‚Р°:

```powershell
npm.cmd ci --no-audit --no-fund
py -3 -m pip install --user -r .\apps\backend\requirements.txt
py -3 -m pip install --user pytest
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-portable-windows.ps1
```

Р РµР·СѓР»СЊС‚Р°С‚:

```text
apps\desktop\release\KubeDeck-Portable-1.1.2-x64.exe
```

---

# Р—Р°РїСѓСЃРє РІ dev-СЂРµР¶РёРјРµ

РР· РєРѕСЂРЅСЏ РїСЂРѕРµРєС‚Р°:

```powershell
npm.cmd ci --no-audit --no-fund
py -3 -m pip install --user -r .\apps\backend\requirements.txt
npm.cmd run dev
```

Dev-СЂРµР¶РёРј Р·Р°РїСѓСЃРєР°РµС‚:

- Vite dev server;
- TypeScript watch;
- Electron desktop shell;
- Р»РѕРєР°Р»СЊРЅС‹Р№ Python backend.

---

# РџСЂРѕРІРµСЂРєР° РїСЂРѕРµРєС‚Р°

РџСЂРѕРІРµСЂРєР° Р±РµР· СЃР±РѕСЂРєРё portable:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate-1.0.5.ps1
```

РџСЂРѕРІРµСЂРєР° СЃРѕ СЃР±РѕСЂРєРѕР№ portable:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-portable-windows.ps1
```

РџСЂРѕРІРµСЂРєР° РІРєР»СЋС‡Р°РµС‚:

- РїСЂРѕРІРµСЂРєСѓ СЃС‚СЂСѓРєС‚СѓСЂС‹ РїСЂРѕРµРєС‚Р°;
- РїСЂРѕРІРµСЂРєСѓ backend Python-РєРѕРґР°;
- backend tests;
- desktop TypeScript/Vite build;
- РїСЂРѕРІРµСЂРєСѓ, С‡С‚Рѕ portable-СЃР±РѕСЂРєР° РЅРµ СЃРѕРґРµСЂР¶РёС‚ `kubectl.exe`;
- optional packaging.

---

# РЎС‚СЂСѓРєС‚СѓСЂР° РїСЂРѕРµРєС‚Р°

```text
kubedeck/
  apps/
    backend/
      app/
      tests/
      requirements.txt
    desktop/
      src/
      electron/
      release/
  packages/
    shared-types/
    ui/
  scripts/
    setup-windows.ps1
    build-portable-windows.ps1
    validate-1.0.5.ps1
    repair-7zip-bin.ps1
  docs/
  README.md
  package.json
  package-lock.json
```

---

# Р§Р°СЃС‚С‹Рµ РѕС€РёР±РєРё Рё СЂРµС€РµРЅРёСЏ

## PowerShell Р·Р°РїСЂРµС‰Р°РµС‚ Р·Р°РїСѓСЃРє СЃРєСЂРёРїС‚Р°

РћС€РёР±РєР°:

```text
running scripts is disabled on this system
```

Р РµС€РµРЅРёРµ:

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1 -Build
```

Р­С‚Р° РєРѕРјР°РЅРґР° РјРµРЅСЏРµС‚ policy С‚РѕР»СЊРєРѕ РґР»СЏ С‚РµРєСѓС‰РµРіРѕ РїСЂРѕС†РµСЃСЃР° PowerShell.

---

## `npm.ps1 cannot be loaded`

РќР° Windows РјРѕР¶РµС‚ Р±Р»РѕРєРёСЂРѕРІР°С‚СЊСЃСЏ `npm.ps1`.

РСЃРїРѕР»СЊР·СѓР№ `npm.cmd`:

```powershell
npm.cmd ci --no-audit --no-fund
npm.cmd run build
npm.cmd run dev
```

---

## `winget` РЅРµ РЅР°Р№РґРµРЅ

РџСЂРѕРІРµСЂСЊ:

```powershell
winget --version
```

Р•СЃР»Рё РєРѕРјР°РЅРґС‹ РЅРµС‚, РѕР±РЅРѕРІРё **App Installer** С‡РµСЂРµР· Microsoft Store.

РџРѕСЃР»Рµ СѓСЃС‚Р°РЅРѕРІРєРё Р·Р°РЅРѕРІРѕ РѕС‚РєСЂРѕР№ PowerShell.

---

## `py` РЅРµ РЅР°Р№РґРµРЅ

РџСЂРѕРІРµСЂСЊ:

```powershell
py -3 --version
```

Р•СЃР»Рё РєРѕРјР°РЅРґС‹ РЅРµС‚:

```powershell
winget install -e --id Python.Python.3.11
```

РџРѕСЃР»Рµ СѓСЃС‚Р°РЅРѕРІРєРё Р·Р°РЅРѕРІРѕ РѕС‚РєСЂРѕР№ PowerShell.

---

## `kubectl executable not found`

KubeDeck РЅРµ СЃРѕРґРµСЂР¶РёС‚ РІСЃС‚СЂРѕРµРЅРЅС‹Р№ `kubectl.exe`.

Р РµС€РµРЅРёРµ:

```powershell
winget install -e --id Kubernetes.kubectl
kubectl version --client
```

РР»Рё СѓРєР°Р¶Рё РїСѓС‚СЊ Рє `kubectl.exe` РІ Settings РїСЂРёР»РѕР¶РµРЅРёСЏ.

---

## `kubectl timed out after 30s`

РџСЂРѕРІРµСЂСЊ СЌС‚Сѓ Р¶Рµ РєРѕРјР°РЅРґСѓ РЅР°РїСЂСЏРјСѓСЋ РІ PowerShell:

```powershell
kubectl get pods -A -o json
```

Р•СЃР»Рё РІ РєРѕРЅСЃРѕР»Рё РєРѕРјР°РЅРґР° СЂР°Р±РѕС‚Р°РµС‚ Р±С‹СЃС‚СЂРѕ, РїСЂРѕРІРµСЂСЊ:

1. РєР°РєРѕР№ kubeconfig РёРјРїРѕСЂС‚РёСЂРѕРІР°РЅ РІ KubeDeck;
2. РєР°РєРѕР№ context РІС‹Р±СЂР°РЅ;
3. РєР°РєРѕР№ `kubectl.exe` РёСЃРїРѕР»СЊР·СѓРµС‚ РїСЂРёР»РѕР¶РµРЅРёРµ;
4. РЅРµС‚ Р»Рё СЃС‚Р°СЂРѕРіРѕ РїСѓС‚Рё РґРѕ `kubectl` РІ Settings;
5. РЅРµС‚ Р»Рё РїСЂРѕР±Р»РµРј СЃ VPN/DNS/Proxy;
6. РЅРµС‚ Р»Рё Р·Р°РІРёСЃС€РёС… РїСЂРѕС†РµСЃСЃРѕРІ KubeDeck.

---

## РћС€РёР±РєР° 7zip / electron-builder

Р•СЃР»Рё СЃР±РѕСЂРєР° РїР°РґР°РµС‚ РЅР° `7za.exe` РёР»Рё `7zip-bin`, РІС‹РїРѕР»РЅРё:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\repair-7zip-bin.ps1
```

Р•СЃР»Рё Defender СѓРґР°Р»РёР» `7za.exe`, РїСЂРѕРІРµСЂСЊ РєР°СЂР°РЅС‚РёРЅ РёР»Рё РґРѕР±Р°РІСЊ РІСЂРµРјРµРЅРЅРѕРµ РёСЃРєР»СЋС‡РµРЅРёРµ РґР»СЏ РїР°РїРєРё РїСЂРѕРµРєС‚Р°.

---

## Release-РґРёСЂРµРєС‚РѕСЂРёСЏ Р·Р°РЅСЏС‚Р°

Р—Р°РєСЂРѕР№ KubeDeck Рё Electron-РїСЂРѕС†РµСЃСЃС‹.

РџРѕС‚РѕРј РїРѕРІС‚РѕСЂРё СЃР±РѕСЂРєСѓ:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-portable-windows.ps1
```

---

# РћР±РЅРѕРІР»РµРЅРёРµ РїСЂРѕРµРєС‚Р°

Р•СЃР»Рё РїСЂРѕРµРєС‚ СѓР¶Рµ СЃРєР»РѕРЅРёСЂРѕРІР°РЅ:

```powershell
cd "$env:USERPROFILE\KubeDeck"
git pull --ff-only
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1 -Build
```

---

# Р§С‚Рѕ РЅРµР»СЊР·СЏ РєРѕРјРјРёС‚РёС‚СЊ

РќРµ РґРѕР±Р°РІР»СЏР№ РІ git:

```text
node_modules/
.build-venv/
build/
apps/desktop/dist/
apps/desktop/release/
*.zip
*.7z
*.log
kubectl.exe
```

---

# Р‘РµР·РѕРїР°СЃРЅРѕСЃС‚СЊ

Р’ РїСЂРѕРµРєС‚Рµ РїСЂРёРЅСЏС‚С‹ СЃР»РµРґСѓСЋС‰РёРµ РїСЂР°РІРёР»Р°:

- backend СЃР»СѓС€Р°РµС‚ С‚РѕР»СЊРєРѕ `127.0.0.1`;
- desktop Рё backend РёСЃРїРѕР»СЊР·СѓСЋС‚ Р»РѕРєР°Р»СЊРЅС‹Р№ session token;
- РґРѕСЃС‚СѓРї Рє Kubernetes РІС‹РїРѕР»РЅСЏРµС‚СЃСЏ С‡РµСЂРµР· Р»РѕРєР°Р»СЊРЅС‹Р№ `kubectl`;
- kubeconfig-С„Р°Р№Р»С‹ РєРѕРїРёСЂСѓСЋС‚СЃСЏ РІ `%APPDATA%\KubeDeck\kubeconfigs`;
- Secrets РЅРµ РґРѕР»Р¶РЅС‹ СЃРѕС…СЂР°РЅСЏС‚СЊСЃСЏ РІ Р»РѕРіР°С…;
- portable-СЃР±РѕСЂРєР° РЅРµ РґРѕР»Р¶РЅР° СЃРѕРґРµСЂР¶Р°С‚СЊ `kubectl.exe`;
- РѕРїР°СЃРЅС‹Рµ РґРµР№СЃС‚РІРёСЏ С‚СЂРµР±СѓСЋС‚ РїРѕРґС‚РІРµСЂР¶РґРµРЅРёСЏ РІ UI.

---

# Smoke test РїРѕСЃР»Рµ СЃР±РѕСЂРєРё

РџРѕСЃР»Рµ СЃР±РѕСЂРєРё РїСЂРѕРІРµСЂСЊ:

1. Р—Р°РїСѓСЃРєР°РµС‚СЃСЏ portable `.exe`.
2. Settings РѕС‚РєСЂС‹РІР°СЋС‚СЃСЏ.
3. РџСѓС‚СЊ РґРѕ `kubectl` РєРѕСЂСЂРµРєС‚РЅС‹Р№.
4. kubeconfig РёРјРїРѕСЂС‚РёСЂСѓРµС‚СЃСЏ.
5. РљР»Р°СЃС‚РµСЂ РѕС‚РєСЂС‹РІР°РµС‚СЃСЏ.
6. Namespace РІС‹Р±РёСЂР°РµС‚СЃСЏ.
7. Pods/Deployments/Services/Events РѕС‚РѕР±СЂР°Р¶Р°СЋС‚СЃСЏ.
8. Pod drawer РѕС‚РєСЂС‹РІР°РµС‚СЃСЏ.
9. YAML РѕС‚РѕР±СЂР°Р¶Р°РµС‚СЃСЏ.
10. Describe СЂР°Р±РѕС‚Р°РµС‚.
11. Logs СЂР°Р±РѕС‚Р°СЋС‚.
12. Deployment logs СЂР°Р±РѕС‚Р°СЋС‚.
13. Problems dashboard РѕС‚РєСЂС‹РІР°РµС‚СЃСЏ.
14. Р’ release-РґРёСЂРµРєС‚РѕСЂРёРё РЅРµС‚ `kubectl.exe`.

---

# РљРѕРјР°РЅРґС‹ РґР»СЏ СЂР°Р·СЂР°Р±РѕС‚С‡РёРєР°

## РЈСЃС‚Р°РЅРѕРІРєР° Р·Р°РІРёСЃРёРјРѕСЃС‚РµР№

```powershell
npm.cmd ci --no-audit --no-fund
py -3 -m pip install --user -r .\apps\backend\requirements.txt
```

## Dev mode

```powershell
npm.cmd run dev
```

## Desktop build

```powershell
npm.cmd run build
```

## Portable package

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-portable-windows.ps1
```

## Git commit РїРѕСЃР»Рµ РёР·РјРµРЅРµРЅРёСЏ README

```powershell
git status
git add README.md scripts/setup-windows.ps1
git commit -m "docs: add full Windows setup guide"
git push
```

