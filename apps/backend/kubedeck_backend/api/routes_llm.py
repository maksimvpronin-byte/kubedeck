from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from kubedeck_backend.core.models import LlmAnalyzeResourceRequest, LlmAnalyzeResourceResponse, LlmSettings, LlmTestRequest
from kubedeck_backend.llm.client import LlmClientError, chat_completion, validate_settings
from kubedeck_backend.llm.context import build_resource_context
from kubedeck_backend.llm.prompts import SYSTEM_PROMPT, build_user_prompt

from .runtime import get_cached_config


router = APIRouter(prefix="/llm")


@router.get("/status")
def llm_status() -> dict[str, Any]:
    settings = get_cached_config().settings.llm
    return _public_status(settings)


@router.post("/test")
def llm_test(request: LlmTestRequest | None = None) -> dict[str, Any]:
    settings = request.settings if request and request.settings else get_cached_config().settings.llm
    try:
        validate_settings(settings, require_enabled=False)
        completion = chat_completion(
            settings.model_copy(update={"enabled": True}),
            [
                {"role": "system", "content": "You are a health check endpoint. Reply with OK."},
                {"role": "user", "content": "Reply with OK."},
            ],
        )
        return {
            "ok": True,
            "message": "Connection successful.",
            "model": completion.model,
            "elapsedMs": completion.elapsed_ms,
            "status": _public_status(settings),
        }
    except LlmClientError as exc:
        return {
            "ok": False,
            "code": exc.code,
            "message": exc.message,
            "status": _public_status(settings),
        }


@router.post("/analyze-resource")
def llm_analyze_resource(request: LlmAnalyzeResourceRequest) -> dict[str, Any]:
    settings = get_cached_config().settings.llm
    try:
        context, context_chars, truncated = build_resource_context(request, settings.maxContextChars)
        completion = chat_completion(
            settings,
            [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": build_user_prompt(context, request.userRequest)},
            ],
        )
    except LlmClientError as exc:
        raise HTTPException(
            status_code=400,
            detail={"code": exc.code, "message": exc.message, "rawStderr": "", "commandPreview": ""},
        ) from exc
    response = LlmAnalyzeResourceResponse(
        answer=completion.answer,
        model=completion.model,
        elapsedMs=completion.elapsed_ms,
        contextChars=context_chars,
        truncated=truncated,
    )
    return response.model_dump()


def _public_status(settings: LlmSettings) -> dict[str, Any]:
    return {
        "enabled": settings.enabled,
        "configured": bool((settings.baseUrl or "").strip() and (settings.model or "").strip()),
        "provider": settings.provider,
        "baseUrl": settings.baseUrl,
        "model": settings.model,
    }
