from __future__ import annotations

import asyncio
import contextlib
import concurrent.futures
import logging
import os
import platform
import random
import re
import socket
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import PlainTextResponse

from kubedeck_backend.core.audit import append_audit_event, read_audit_events
from kubedeck_backend.core.models import ApplyYamlRequest, ImportClusterRequest, PodExecRequest, PortForwardStartRequest, RenameClusterRequest, ResourceActionRequest, SettingsUpdateRequest, YamlRequest
from kubedeck_backend.core.paths import appdata_dir, config_path, ensure_app_dirs
from kubedeck_backend.kubectl.command import KubectlCommand, KubectlError, kubectl_environment
from kubedeck_backend.api.runtime import clear_config_cache, cluster_command, get_cached_config, kubectl_error, runner, store
from kubedeck_backend.api.validation import api_error, ensure_payload_size, normalize_tail_lines, require_confirmation, validate_identifier
from kubedeck_backend.api.terminal import (
    build_terminal_command,
    normalize_terminal_shell,
    pod_terminal_pipes,
    pod_terminal_pty,
    terminal_pty_available,
)
from kubedeck_backend.api.port_forward import (
    can_bind_local_port,
    discover_external_port_forwards,
    find_available_local_port,
    is_local_port_registered,
    is_kubectl_port_forward_process,
    is_process_running,
    load_port_forward_registry,
    normalize_port_forward_local_port,
    parse_port_forward_cmdline,
    parse_port_forward_resource_ref,
    port_forward_output,
    port_forward_registry_path,
    port_forwards,
    prune_port_forwards,
    save_port_forward_registry,
    session_view,
    start_port_forward_output_readers,
    stop_kubectl_port_forward_process,
    wait_for_port_forward_ready,
)
from kubedeck_backend.api.search import (
    SEARCH_CONCURRENCY,
    SEARCH_MAX_OUTPUT_BYTES,
    SEARCH_QUERY_MAX_CHARS,
    SEARCH_TOTAL_TIMEOUT_SECONDS,
    build_search_resource_specs,
    deduplicate_search_results,
    generic_summary,
    get_cached_resource_definitions,
    normalize_search_namespaces,
    normalize_search_query,
    parse_api_resources,
    search_resource,
    search_sort_key,
)
from kubedeck_backend.api.problems import (
    apply_pod_metrics,
    build_problem_rows,
    format_memory_metric,
    load_problem_resource,
    parse_pod_metrics,
    parse_ready_pair,
    problem_row,
    problem_sort_key,
    summarize_problems,
)
from kubedeck_backend.api.relations import (
    binding_has_service_account_subject_raw,
    build_related_links,
    dedupe_related_links,
    filter_events_for_target,
    has_owner,
    kind_for_resource,
    load_raw_items,
    load_target_raw,
    metadata_name,
    metadata_namespace,
    normalizer_for_resource,
    pod_reference_links,
    pod_uses_config_resource,
    pod_uses_pvc,
    related_link,
    role_ref_detail_raw,
    role_ref_links_raw,
    selector_detail,
    selector_from_workload,
    selector_matches,
    singular_kind,
    subject_links_raw,
    subjects_detail_raw,
)
from kubedeck_backend.security import verify_session_token, websocket_origin_allowed, websocket_token
from kubedeck_backend.resources.normalizers import (
    crd_summary,
    deployment_summary,
    event_summary,
    ingress_backend_services,
    ingress_summary,
    meta,
    node_summary,
    pod_summary,
    role_binding_summary,
    role_summary,
    service_account_summary,
    service_summary,
)

log = logging.getLogger(__name__)
MAX_EXEC_COMMAND_CHARS = 4000
MAX_APPLY_YAML_BYTES = 5 * 1024 * 1024
RESOURCE_JSON_MAX_OUTPUT_BYTES = 64 * 1024 * 1024
TEXT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024
LOGS_MAX_OUTPUT_BYTES = 8 * 1024 * 1024
LOGS_FULL_MAX_OUTPUT_BYTES = 32 * 1024 * 1024

def verify_auth_can_i(cluster_id: str, verb: str, resource: str, namespace: str) -> None:
    args = ["auth", "can-i", verb, resource]
    if namespace != "_cluster":
        args.extend(["-n", namespace])
    try:
        output = runner.run(cluster_command(cluster_id, args, timeout=15)).stdout.strip().lower()
    except KubectlError as exc:
        raise kubectl_error(exc)
    if output not in {"yes", "y"}:
        raise HTTPException(status_code=403, detail={"code": "KUBECTL_AUTH_DENIED", "message": f"kubectl auth can-i {verb} {resource} returned {output or 'no'}", "rawStderr": "", "commandPreview": " ".join(args)})


def auth_check_for_action(cluster_id: str, action: str, resource: str, namespace: str) -> None:
    if action == "delete" or (resource in {"pod", "pods"} and action in {"restart", "redeploy"}):
        verify_auth_can_i(cluster_id, "delete", resource, namespace)
        return
    if action in {"restart", "redeploy"}:
        verify_auth_can_i(cluster_id, "patch", resource, namespace)
        return
    if action == "scale":
        verify_auth_can_i(cluster_id, "update", f"{resource}/scale", namespace)









