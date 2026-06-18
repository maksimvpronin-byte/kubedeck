from __future__ import annotations

import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from kubedeck_backend.security import SessionTokenMiddleware, TOKEN_HEADER, expected_session_token, unauthenticated_allowed

from kubedeck_backend.api.routes import router
from kubedeck_backend.core.paths import ensure_app_dirs
from kubedeck_backend.logging_config import configure_logging
from kubedeck_backend.api.watch_manager import stop_all_resource_watches


configure_logging()
ensure_app_dirs()
log = logging.getLogger(__name__)

app = FastAPI(title="KubeDeck Backend", version="1.1.0")
app.add_middleware(SessionTokenMiddleware, public_paths={"/health"})
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "file://", "null"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["Content-Type", TOKEN_HEADER],
)
app.include_router(router)


@app.on_event("startup")
def startup() -> None:
    auth_mode = "token" if expected_session_token() else ("disabled" if unauthenticated_allowed() else "locked")
    log.info("backend startup pid=%s auth=%s", os.getpid(), auth_mode)


@app.on_event("shutdown")
def shutdown() -> None:
    try:
        result = stop_all_resource_watches()
        if result.get("stopped"):
            log.info("stopped resource watches count=%s", result.get("stopped"))
    except Exception as exc:
        log.warning("failed to stop resource watches during shutdown: %s", exc)
    log.info("backend shutdown")


def main() -> None:
    import uvicorn

    port = int(os.environ.get("KUBEDECK_BACKEND_PORT", "0"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")


if __name__ == "__main__":
    main()
