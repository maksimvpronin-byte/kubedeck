from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

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
    payload = {
        "model": settings.model,
        "messages": messages,
        "temperature": settings.temperature,
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

    answer = _extract_message_content(body)
    if not answer:
        raise LlmClientError("LLM_EMPTY_RESPONSE", "No LLM response content.")
    model = str(body.get("model") or settings.model)
    return LlmCompletion(answer=answer, model=model, elapsed_ms=elapsed_ms)


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
    if isinstance(message, dict) and isinstance(message.get("content"), str):
        return message["content"].strip()
    text = first.get("text")
    return text.strip() if isinstance(text, str) else ""


def _safe_reason(exc: urllib.error.URLError) -> str:
    reason = getattr(exc, "reason", "")
    text = str(reason or exc)
    if len(text) > 180:
        return text[:177] + "..."
    return text
