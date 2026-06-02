from __future__ import annotations

from fastapi import APIRouter

from .common import *


router = APIRouter()


@router.get("/audit")
def audit_events(limit: int = Query(default=200, ge=1, le=1000)) -> dict[str, Any]:
    return {"items": read_audit_events(limit), "limit": limit}
