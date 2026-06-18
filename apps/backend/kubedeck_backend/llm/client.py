
from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any

from kubedeck_backend.core.models import LlmSettings


@dataclass
class LlmCompletion:
    answer: str
    model: str
    elapsed_ms: int


class LlmClientError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def normalize_base_url(base_url: str) -> str:
    value = (base_url or "").strip().rstrip("/")
    if not value:
        raise LlmClientError("LLM_BASE_URL_MISSING", "LLM API base URL is missing.")
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise LlmClientError("LLM_BASE_URL_INVALID", "LLM API base URL must be an http(s) URL.")
    if value.endswith("/chat/completions"):
        value = value[: -len("/chat/completions")]
    if not value.endswith("/v1"):
        value = f"{value}/v1"
    return value


def validate_settings(settings: LlmSettings, require_enabled: bool = True) -> None:
    if require_enabled and not settings.enabled:
        raise LlmClientError("LLM_DISABLED", "LLM integration is disabled.")
    normalize_base_url(settings.baseUrl)
    if not (settings.model or "").strip():
        raise LlmClientError("LLM_MODEL_MISSING", "LLM model is missing.")
    if settings.provider != "openai_compatible":
        raise LlmClientError("LLM_PROVIDER_UNSUPPORTED", "Only OpenAI-compatible local APIs are supported.")


def chat_completion(settings: LlmSettings, messages: list[dict[str, str]]) -> LlmCompletion:
    validate_settings(settings)
    endpoint = f"{normalize_base_url(settings.baseUrl)}/chat/completions"
    max_output_tokens = int(getattr(settings, "maxOutputTokens", 4096) or 4096)
    payload: dict[str, Any] = {
        "model": settings.model,
        "messages": messages,
        "temperature": settings.temperature,
        "max_tokens": max_output_tokens,
    }
    headers = {"Content-Type": "application/json"}
    api_key = (settings.apiKey or "").strip()
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )

    start = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=settings.timeoutSeconds) as response:
            raw = response.read().decode("utf-8")
    except TimeoutError as exc:
        raise LlmClientError("LLM_TIMEOUT", "LLM request timed out.") from exc
    except urllib.error.HTTPError as exc:
        raise LlmClientError("LLM_HTTP_ERROR", f"LLM server returned HTTP {exc.code}.") from exc
    except urllib.error.URLError as exc:
        raise LlmClientError("LLM_UNREACHABLE", f"LLM server is unreachable: {_safe_reason(exc)}") from exc
    except OSError as exc:
        raise LlmClientError("LLM_UNREACHABLE", "LLM server is unreachable.") from exc

    elapsed_ms = int((time.perf_counter() - start) * 1000)
    try:
        body = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise LlmClientError("LLM_INVALID_RESPONSE", "LLM response is not valid JSON.") from exc

    raw_answer = _extract_message_content(body)
    finish_reason = _extract_finish_reason(body)
    reasoning = _extract_reasoning_content(body)

    if not raw_answer and reasoning and finish_reason == "length":
        raise LlmClientError(
            "LLM_OUTPUT_TOKEN_LIMIT",
            f"LLM reached maxOutputTokens ({max_output_tokens}) before producing final content. Increase max output tokens or reduce input context.",
        )
    if not raw_answer and reasoning:
        raise LlmClientError(
            "LLM_EMPTY_FINAL_RESPONSE",
            "LLM returned only reasoning/thinking without a final answer.",
        )
    if not raw_answer:
        raise LlmClientError("LLM_EMPTY_RESPONSE", "No LLM response content.")

    answer = _extract_final_block(raw_answer)
    if not answer:
        answer = _strip_thinking(raw_answer)
    if not answer:
        raise LlmClientError("LLM_EMPTY_FINAL_RESPONSE", "LLM final answer is empty after removing reasoning/thinking.")

    rendered = _render_standard_answer(answer, messages)
    model = str(body.get("model") or settings.model)
    return LlmCompletion(answer=rendered, model=model, elapsed_ms=elapsed_ms)


def _extract_message_content(body: object) -> str:
    if not isinstance(body, dict):
        return ""
    choices = body.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    first = choices[0]
    if not isinstance(first, dict):
        return ""
    message = first.get("message")
    if isinstance(message, dict):
        content = message.get("content")
        return _content_to_text(content).strip()
    text = first.get("text")
    return text.strip() if isinstance(text, str) else ""


def _content_to_text(content: object) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                value = item.get("text") or item.get("content")
                if isinstance(value, str):
                    parts.append(value)
        return "\n".join(parts)
    if isinstance(content, dict):
        value = content.get("text") or content.get("content")
        return value if isinstance(value, str) else ""
    return ""


def _extract_reasoning_content(body: object) -> str:
    if not isinstance(body, dict):
        return ""
    choices = body.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    first = choices[0]
    if not isinstance(first, dict):
        return ""
    message = first.get("message")
    if not isinstance(message, dict):
        return ""
    for key in ("reasoning_content", "reasoning", "thinking"):
        value = message.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _extract_finish_reason(body: object) -> str:
    if not isinstance(body, dict):
        return ""
    choices = body.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    first = choices[0]
    if not isinstance(first, dict):
        return ""
    value = first.get("finish_reason")
    return value if isinstance(value, str) else ""


def _extract_final_block(text: str) -> str:
    match = re.search(r"<kubedeck_final>\s*(.*?)\s*</kubedeck_final>", text, flags=re.IGNORECASE | re.DOTALL)
    return match.group(1).strip() if match else ""


def _strip_thinking(text: str) -> str:
    value = re.sub(r"<think>.*?</think>", "", text, flags=re.IGNORECASE | re.DOTALL).strip()
    markers = ["Thinking Process:", "Reasoning:", "Analysis:"]
    for marker in markers:
        idx = value.find(marker)
        if idx >= 0:
            value = value[:idx].strip()
    return value


def _render_standard_answer(answer: str, messages: list[dict[str, str]]) -> str:
    parsed = _parse_json_answer(answer)
    if parsed is None:
        return answer.strip()

    # Important: render/health normalization must use only the Kubernetes context,
    # not the system prompt. The system prompt contains healthy examples such as
    # "Phase: Running" and could otherwise mark a Pending target Pod as healthy.
    context_text = _extract_kubedeck_context(messages)
    parsed = _normalize_answer(parsed, context_text)

    sections = [
        ("1. Короткий вывод", "conclusion", 2),
        ("2. Факты из контекста", "facts", 7),
        ("3. Проблемы / риски", "risks", 3),
        ("4. Что проверить дальше", "nextChecks", 3),
        ("5. Чего не хватает", "missing", 2),
    ]
    blocks: list[str] = []
    for title, key, limit in sections:
        items = _as_items(parsed.get(key))
        if not items:
            items = _default_items_for(key)
        blocks.append(title + "\n" + "\n".join(f"- {item}" for item in items[:limit]))
    return "\n\n".join(blocks).strip()


def _extract_kubedeck_context(messages: list[dict[str, str]]) -> str:
    user_texts = [str(message.get("content", "")) for message in messages if message.get("role") == "user"]
    for content in reversed(user_texts):
        match = re.search(
            r"KUBEDECK CONTEXT START\s*(.*?)\s*KUBEDECK CONTEXT END",
            content,
            flags=re.IGNORECASE | re.DOTALL,
        )
        if match:
            return match.group(1).strip()
    return "\n".join(user_texts).strip()


def _parse_json_answer(answer: str) -> dict[str, Any] | None:
    text = answer.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE).strip()
    text = re.sub(r"\s*```$", "", text).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        text = text[start : end + 1]
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None


def _as_items(value: object) -> list[str]:
    if isinstance(value, list):
        result = [str(item).strip().lstrip("-•* ").strip() for item in value if str(item).strip()]
    elif isinstance(value, str) and value.strip():
        result = [value.strip().lstrip("-•* ").strip()]
    else:
        result = []
    cleaned = [_clean_item(item) for item in result if _clean_item(item)]
    return _dedupe_items(cleaned)


def _clean_item(item: str) -> str:
    return " ".join(item.split())


def _dedupe_items(items: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        key = item.lower().rstrip(".")
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


def _default_items_for(key: str) -> list[str]:
    defaults = {
        "conclusion": ["Недостаточно данных для краткого вывода."],
        "facts": ["Факты не выделены моделью."],
        "risks": ["Активных проблем не выявлено."],
        "nextChecks": ["Ничего срочного."],
        "missing": ["Контекст достаточен для диагностики текущего состояния."],
    }
    return defaults[key]


def _normalize_answer(answer: dict[str, Any], context_text: str) -> dict[str, Any]:
    normalized = dict(answer)
    target_context = _target_resource_context(context_text)
    target_lower = target_context.lower()

    healthy = _is_healthy_running_pod(target_lower)
    image_pull_error = _has_image_pull_error(target_lower)

    facts = _build_pod_facts(target_context, target_lower)
    if facts:
        normalized["facts"] = facts

    if image_pull_error:
        reason = _extract_image_pull_reason(target_lower) or "ImagePullBackOff"
        image = _extract_image(target_context) or "образ из контекста"
        normalized["conclusion"] = [f"Pod не стартует: Pending/Ready 0/1 из-за {reason}."]
        normalized["risks"] = [
            "Контейнер не запустится, пока образ не будет доступен.",
            "Вероятная причина связана с именем образа, тегом, registry или авторизацией.",
        ]
        normalized["nextChecks"] = [
            f"Проверить имя образа и тег: {image}.",
            "Проверить доступность registry с node.",
            "Проверить imagePullSecret, если registry приватный.",
        ]
        normalized["missing"] = ["Контекст достаточен для первичной диагностики ImagePullBackOff."]
        return normalized

    if healthy:
        normalized["conclusion"] = ["Pod работает стабильно: Running, Ready 1/1, рестартов нет."]
        normalized["risks"] = ["Активных проблем не выявлено."]
        normalized["nextChecks"] = ["Ничего срочного."]
        normalized["missing"] = ["Контекст достаточен для диагностики текущего состояния."]
        return normalized

    if _is_unhealthy_pod(target_lower):
        normalized["conclusion"] = ["Pod не находится в полностью рабочем состоянии; смотри факты и события ниже."]
        normalized["risks"] = _filter_risks(_as_items(normalized.get("risks")), target_lower, healthy) or [
            "Есть признаки неготовности или ошибки запуска контейнера."
        ]
        normalized["nextChecks"] = _filter_next_checks(_as_items(normalized.get("nextChecks")), target_lower, healthy) or [
            "Проверить Reason/Message в describe и события Pod.",
            "Проверить состояние контейнера и readiness.",
        ]
        normalized["missing"] = _filter_missing(_as_items(normalized.get("missing")), target_lower, healthy) or [
            "Контекст достаточен для первичной диагностики текущего состояния."
        ]
        return normalized

    normalized["missing"] = _filter_missing(_as_items(normalized.get("missing")), target_lower, healthy)
    normalized["risks"] = _filter_risks(_as_items(normalized.get("risks")), target_lower, healthy)
    normalized["nextChecks"] = _filter_next_checks(_as_items(normalized.get("nextChecks")), target_lower, healthy)
    normalized["nextChecks"] = _filter_image_tag_examples(_as_items(normalized.get("nextChecks")), target_lower)
    normalized["risks"] = _filter_image_tag_examples(_as_items(normalized.get("risks")), target_lower)

    if not normalized["missing"]:
        normalized["missing"] = ["Контекст достаточен для диагностики текущего состояния."]

    return normalized


def _target_resource_context(context_text: str) -> str:
    text = context_text or ""
    upper = text.upper()
    markers = [
        "\nRELATED RESOURCES SUMMARY ONLY",
        "\nRELATED RESOURCES SUMMARY",
        "\nRELATED RESOURCES",
    ]
    end = len(text)
    for marker in markers:
        idx = upper.find(marker)
        if idx >= 0:
            end = min(end, idx)
    return text[:end].strip() or text


def _is_healthy_running_pod(lower_context: str) -> bool:
    if _has_image_pull_error(lower_context):
        return False
    if _is_unhealthy_pod(lower_context):
        return False
    has_running = "phase: running" in lower_context or "status: running" in lower_context
    has_ready = "ready: 1/1" in lower_context or "ready 1/1" in lower_context
    has_zero_restarts = any(token in lower_context for token in ("restarts: 0", "restartcount: 0", "restartcount=0"))
    return has_running and has_ready and has_zero_restarts


def _is_unhealthy_pod(lower_context: str) -> bool:
    if any(token in lower_context for token in ("phase: pending", "phase: failed", "phase: unknown")):
        return True
    if any(token in lower_context for token in ("ready: 0/1", "ready 0/1", "ready: false")):
        return True
    if any(token in lower_context for token in ("crashloopbackoff", "errimagepull", "imagepullbackoff", "oomkilled")):
        return True
    return False


def _has_image_pull_error(lower_context: str) -> bool:
    return "imagepullbackoff" in lower_context or "errimagepull" in lower_context


def _extract_image_pull_reason(lower_context: str) -> str:
    if "imagepullbackoff" in lower_context:
        return "ImagePullBackOff"
    if "errimagepull" in lower_context:
        return "ErrImagePull"
    return ""


def _extract_image(context_text: str) -> str:
    return _extract_first(context_text, [r"(?im)^image:\s*([^\r\n]+)", r"(?im)^\s*Image:\s*([^\r\n]+)"])


def _build_pod_facts(context_text: str, lower_context: str) -> list[str]:
    if "resource: pods" not in lower_context and "kind: pods" not in lower_context and "kind: pod" not in lower_context:
        return []

    phase = _extract_first(context_text, [r"(?im)^phase:\s*([^\r\n]+)"])
    ready = _extract_first(context_text, [r"(?im)^ready:\s*([^\r\n]+)"])
    restarts = _extract_first(context_text, [r"(?im)^restarts:\s*(\d+)", r"(?im)^restartCount:\s*(\d+)"])
    node = _extract_first(context_text, [r"(?im)^node:\s*([^\r\n]+)"])
    image = _extract_image(context_text)
    reason = _extract_first(context_text, [r"(?im)^reason:\s*([^\r\n]+)"])
    if _has_image_pull_error(lower_context):
        reason = _extract_image_pull_reason(lower_context)

    facts: list[str] = []
    if phase:
        facts.append(f"Phase: {_trim_value(phase)}.")
    if ready:
        facts.append(f"Ready: {_trim_value(ready)}.")
    if restarts:
        facts.append(f"Restarts: {_trim_value(restarts)}.")
    if reason and reason.lower() not in {"unknown", "none", "not provided"}:
        facts.append(f"Reason: {_trim_value(reason)}.")
    if node:
        facts.append(f"Node: {_trim_value(node)}.")
    if image:
        facts.append(f"Image: {_trim_value(image)}.")
    events_fact = _events_fact(lower_context)
    if events_fact:
        facts.append(events_fact)
    return _dedupe_items(facts)


def _extract_first(text: str, patterns: list[str]) -> str:
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            value = match.group(1).strip()
            if value and value.lower() not in {"not provided", "none"}:
                return value
    return ""


def _trim_value(value: str) -> str:
    cleaned = value.strip().strip('"').strip("'")
    cleaned = re.sub(r"\s+", " ", cleaned)
    if len(cleaned) > 120:
        cleaned = cleaned[:117] + "..."
    return cleaned.rstrip(".")


def _events_fact(lower_context: str) -> str:
    if "events: <none>" in lower_context or "events\n<none>" in lower_context or "provided_empty" in lower_context:
        return "Events: <none>, предупреждений нет."
    if "warning" in lower_context and "event" in lower_context:
        return "Events: warning events присутствуют."
    return ""


def _filter_missing(items: list[str], lower_context: str, healthy: bool) -> list[str]:
    result: list[str] = []
    has_zero_restarts = any(token in lower_context for token in ("restarts: 0", "restartcount: 0", "restartcount=0"))
    for item in items:
        lower = item.lower()
        if has_zero_restarts and any(token in lower for token in ("previous", "предыдущ", "previouslogs")):
            continue
        if "events" in lower or "событ" in lower:
            if "events: <none>" in lower_context or "provided_empty" in lower_context:
                continue
        if ("deployment" in lower or "replicaset" in lower or "манифест" in lower) and _pod_has_core_spec(lower_context):
            continue
        if healthy and any(token in lower for token in ("pressure", "давлен", "kubelet", "registry", "реестр")):
            continue
        result.append(item)
    return result


def _filter_risks(items: list[str], lower_context: str, healthy: bool) -> list[str]:
    if healthy:
        critical_evidence = any(token in lower_context for token in ("errimagepull", "imagepullbackoff", "oomkilled", "crashloopbackoff", "exit code: 255"))
        if not critical_evidence:
            return ["Активных проблем не выявлено."]
    return items


def _filter_next_checks(items: list[str], lower_context: str, healthy: bool) -> list[str]:
    if healthy:
        filtered: list[str] = []
        for item in items:
            lower = item.lower()
            if any(token in lower for token in ("registry", "реестр", "kubelet", "pressure", "давлен", "deployment", "replicaset")):
                continue
            filtered.append(item)
        return filtered or ["Ничего срочного."]
    return items


def _filter_image_tag_examples(items: list[str], lower_context: str) -> list[str]:
    result: list[str] = []
    for item in items:
        lower = item.lower()
        if "latest" in lower and "latest" not in lower_context:
            continue
        if "например" in lower and any(token in lower for token in ("tag", "тег", "образ", "image")):
            continue
        result.append(item)
    return result


def _pod_has_core_spec(lower_context: str) -> bool:
    return any(token in lower_context for token in ("image:", "resources:", "limits:", "requests:", "qos class"))


def _safe_reason(exc: urllib.error.URLError) -> str:
    reason = getattr(exc, "reason", "")
    text = str(reason or exc)
    if len(text) > 180:
        return text[:177] + "..."
    return text
