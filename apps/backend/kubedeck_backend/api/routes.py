from __future__ import annotations

from fastapi import APIRouter

from .routes_audit import router as audit_router
from .routes_clusters import router as clusters_router
from .routes_core import router as core_router
from .routes_llm import router as llm_router
from .routes_pods import router as pods_router
from .routes_port_forward import router as port_forward_router
from .routes_problems import router as problems_router
from .routes_resources import router as resources_router
from .routes_search import router as search_router
from .routes_yaml import router as yaml_router
from .routes_watch import router as watch_router
from .routes_node_ssh import router as node_ssh_router


router = APIRouter()

# Keep route ordering explicit. Some cluster paths are close enough that
# registration order matters, so each subrouter preserves the ordering that
# existed in the old monolithic routes.py file.
for subrouter in (
    core_router,
    llm_router,
    audit_router,
    clusters_router,
    port_forward_router,
    resources_router,
    problems_router,
    search_router,
    yaml_router,
    watch_router,
    node_ssh_router,
    pods_router,
):
    router.include_router(subrouter)
