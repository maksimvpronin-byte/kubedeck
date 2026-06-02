from __future__ import annotations

import os
import secrets
from urllib.parse import urlparse

from fastapi import Request, WebSocket
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp


TOKEN_HEADER = "X-KubeDeck-Token"
TOKEN_ENV = "KUBEDECK_SESSION_TOKEN"
ALLOW_UNAUTHENTICATED_ENV = "KUBEDECK_ALLOW_UNAUTHENTICATED"

_ALLOWED_WS_ORIGINS = {
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "file://",
    "null",
    "",
}


def expected_session_token() -> str:
    return os.environ.get(TOKEN_ENV, "").strip()


def unauthenticated_allowed() -> bool:
    return os.environ.get(ALLOW_UNAUTHENTICATED_ENV, "").strip().lower() in {"1", "true", "yes", "on"}


def verify_session_token(token: str | None) -> bool:
    expected = expected_session_token()
    if not expected:
        return unauthenticated_allowed()
    return secrets.compare_digest(token or "", expected)


def auth_error_response(status_code: int = 401) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "detail": {
                "code": "UNAUTHORIZED",
                "message": "KubeDeck session token is missing or invalid",
                "rawStderr": "",
                "commandPreview": "",
            }
        },
    )


class SessionTokenMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp, public_paths: set[str] | None = None) -> None:
        super().__init__(app)
        self.public_paths = public_paths or set()

    async def dispatch(self, request: Request, call_next):  # type: ignore[no-untyped-def]
        if request.method.upper() == "OPTIONS" or request.url.path in self.public_paths:
            return await call_next(request)
        if verify_session_token(request.headers.get(TOKEN_HEADER)):
            return await call_next(request)
        return auth_error_response()


def websocket_token(websocket: WebSocket, query_token: str | None = None) -> str:
    return query_token or websocket.headers.get(TOKEN_HEADER, "")


def websocket_origin_allowed(websocket: WebSocket) -> bool:
    origin = websocket.headers.get("origin", "")
    if origin in _ALLOWED_WS_ORIGINS:
        return True
    parsed = urlparse(origin)
    if parsed.scheme in {"http", "https"} and parsed.hostname in {"127.0.0.1", "localhost"}:
        return True
    return False
