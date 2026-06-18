# Graph Report - .  (2026-06-18)

## Corpus Check
- 167 files · ~113,379 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1402 nodes · 3057 edges · 90 communities (77 shown, 13 thin omitted)
- Extraction: 87% EXTRACTED · 13% INFERRED · 0% AMBIGUOUS · INFERRED: 410 edges (avg confidence: 0.76)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_cluster init KubectlCommand|cluster init KubectlCommand]]
- [[_COMMUNITY_cluster cache audit|cluster cache audit]]
- [[_COMMUNITY_watch stop all|watch stop all]]
- [[_COMMUNITY_bulkDeleteListText bulkDeleteNamespaceSummary tsx|bulkDeleteListText bulkDeleteNamespaceSummary tsx]]
- [[_COMMUNITY_ApiClient constructor health|ApiClient constructor health]]
- [[_COMMUNITY_tsx AboutPanel global|tsx AboutPanel global]]
- [[_COMMUNITY_resource cache invalidate|resource cache invalidate]]
- [[_COMMUNITY_links pod endpoint|links pod endpoint]]
- [[_COMMUNITY_BackendPidFile AppFolder BackendConfig|BackendPidFile AppFolder BackendConfig]]
- [[_COMMUNITY_ssh normalize session|ssh normalize session]]
- [[_COMMUNITY_react types xterm|react types xterm]]
- [[_COMMUNITY_react types xterm|react types xterm]]
- [[_COMMUNITY_SettingsPanel normalizeConfigSsh tsx|SettingsPanel normalizeConfigSsh tsx]]
- [[_COMMUNITY_port forward local|port forward local]]
- [[_COMMUNITY_tsx CommandPalette HelpPanel|tsx CommandPalette HelpPanel]]
- [[_COMMUNITY_ResourceSummary tsx ResourceSummaryProps|ResourceSummary tsx ResourceSummaryProps]]
- [[_COMMUNITY_tsx DescribeTab LogsTab|tsx DescribeTab LogsTab]]
- [[_COMMUNITY_AuditPanel tsx PortForwardsPanel|AuditPanel tsx PortForwardsPanel]]
- [[_COMMUNITY_resource secret deployment|resource secret deployment]]
- [[_COMMUNITY_ProblemsPanel tsx SeverityFilter|ProblemsPanel tsx SeverityFilter]]
- [[_COMMUNITY_ResourceSummary tsx ResourceSummaryProps|ResourceSummary tsx ResourceSummaryProps]]
- [[_COMMUNITY_ResourceSummary tsx ResourceSummaryProps|ResourceSummary tsx ResourceSummaryProps]]
- [[_COMMUNITY_search resource matches|search resource matches]]
- [[_COMMUNITY_summary format pod|summary format pod]]
- [[_COMMUNITY_deployment secret logs|deployment secret logs]]
- [[_COMMUNITY_tsx initialSection BulkDeleteFailure|tsx initialSection BulkDeleteFailure]]
- [[_COMMUNITY_summary format role|summary format role]]
- [[_COMMUNITY_routes auth action|routes auth action]]
- [[_COMMUNITY_problem problems category|problem problems category]]
- [[_COMMUNITY_apply yaml target|apply yaml target]]
- [[_COMMUNITY_tsconfig renderer json|tsconfig renderer json]]
- [[_COMMUNITY_RelatedTab tsx RelatedTabProps|RelatedTab tsx RelatedTabProps]]
- [[_COMMUNITY_Assert Install Ensure|Assert Install Ensure]]
- [[_COMMUNITY_Assert Install Ensure|Assert Install Ensure]]
- [[_COMMUNITY_ResourceTable HIDDEN COLUMNS|ResourceTable HIDDEN COLUMNS]]
- [[_COMMUNITY_ResourceTable HIDDEN COLUMNS|ResourceTable HIDDEN COLUMNS]]
- [[_COMMUNITY_ResourceTable HIDDEN COLUMNS|ResourceTable HIDDEN COLUMNS]]
- [[_COMMUNITY_ResourceTable HIDDEN COLUMNS|ResourceTable HIDDEN COLUMNS]]
- [[_COMMUNITY_ResourceTable HIDDEN COLUMNS|ResourceTable HIDDEN COLUMNS]]
- [[_COMMUNITY_ResourceTable HIDDEN COLUMNS|ResourceTable HIDDEN COLUMNS]]
- [[_COMMUNITY_ResourceTable HIDDEN COLUMNS|ResourceTable HIDDEN COLUMNS]]
- [[_COMMUNITY_terminal pod WebSocket|terminal pod WebSocket]]
- [[_COMMUNITY_PodDrawerModals tsx ResourceAction|PodDrawerModals tsx ResourceAction]]
- [[_COMMUNITY_tsx Props CommandPreviewBlock|tsx Props CommandPreviewBlock]]
- [[_COMMUNITY_NodeSshTab tsx AuthMethod|NodeSshTab tsx AuthMethod]]
- [[_COMMUNITY_package json name|package json name]]
- [[_COMMUNITY_resource cached cache|resource cached cache]]
- [[_COMMUNITY_EventsTab tsx EventTypeFilter|EventsTab tsx EventTypeFilter]]
- [[_COMMUNITY_tsconfig json compilerOptions|tsconfig json compilerOptions]]
- [[_COMMUNITY_package json name|package json name]]
- [[_COMMUNITY_PortForwardModal tsx defaultPortForwardDraft|PortForwardModal tsx defaultPortForwardDraft]]
- [[_COMMUNITY_TerminalTab tsx TerminalShell|TerminalTab tsx TerminalShell]]
- [[_COMMUNITY_kubeResources normalizeNamespaceSelection arraysEqual|kubeResources normalizeNamespaceSelection arraysEqual]]
- [[_COMMUNITY_YamlTab tsx YamlTabProps|YamlTab tsx YamlTabProps]]
- [[_COMMUNITY_kubeResources normalizeNamespaceSelection arraysEqual|kubeResources normalizeNamespaceSelection arraysEqual]]
- [[_COMMUNITY_package windows ps1|package windows ps1]]
- [[_COMMUNITY_ResourceSummary tsx ResourceSummaryProps|ResourceSummary tsx ResourceSummaryProps]]
- [[_COMMUNITY_index Theme Language|index Theme Language]]
- [[_COMMUNITY_package windows ps1|package windows ps1]]
- [[_COMMUNITY_WatchEntry time parseTimestamp|WatchEntry time parseTimestamp]]
- [[_COMMUNITY_kubectl KubeDeck Desktop|kubectl KubeDeck Desktop]]
- [[_COMMUNITY_FastAPI backend Electron|FastAPI backend Electron]]
- [[_COMMUNITY_version ps1 Utf8NoBom|version ps1 Utf8NoBom]]
- [[_COMMUNITY_package json name|package json name]]
- [[_COMMUNITY_package json name|package json name]]
- [[_COMMUNITY_ResourceSnapshotCache Watch WebSocket|ResourceSnapshotCache Watch WebSocket]]
- [[_COMMUNITY_cache Watch WebSocket|cache Watch WebSocket]]
- [[_COMMUNITY_Remove clean local|Remove clean local]]
- [[_COMMUNITY_Session token authentication|Session token authentication]]
- [[_COMMUNITY_init TODO Foundation|init TODO Foundation]]
- [[_COMMUNITY_init TODO Foundation|init TODO Foundation]]
- [[_COMMUNITY_init TODO Foundation|init TODO Foundation]]
- [[_COMMUNITY_init TODO Foundation|init TODO Foundation]]
- [[_COMMUNITY_init TODO Foundation|init TODO Foundation]]
- [[_COMMUNITY_Redaction|Redaction]]

## God Nodes (most connected - your core abstractions)
1. `ApiClient` - 73 edges
2. `ResourceRow` - 42 edges
3. `validate_identifier()` - 37 edges
4. `kubectl_error()` - 36 edges
5. `cluster_command()` - 34 edges
6. `ErrorInfo` - 32 edges
7. `build_related_links()` - 25 edges
8. `append_audit_event()` - 23 edges
9. `KubectlCommand` - 22 edges
10. `Settings` - 19 edges

## Surprising Connections (you probably didn't know these)
- `open_cluster()` --calls--> `cluster_command()`  [INFERRED]
  .kubedeck_patch_backup/1.0.5-20260617-143139/apps/backend/kubedeck_backend/api/routes_clusters.py → apps/backend/kubedeck_backend/api/runtime.py
- `open_cluster()` --calls--> `kubectl_error()`  [INFERRED]
  .kubedeck_patch_backup/1.0.5-20260617-143139/apps/backend/kubedeck_backend/api/routes_clusters.py → apps/backend/kubedeck_backend/api/runtime.py
- `namespaces()` --calls--> `cluster_command()`  [INFERRED]
  .kubedeck_patch_backup/1.0.5-20260617-143139/apps/backend/kubedeck_backend/api/routes_clusters.py → apps/backend/kubedeck_backend/api/runtime.py
- `namespaces()` --calls--> `kubectl_error()`  [INFERRED]
  .kubedeck_patch_backup/1.0.5-20260617-143139/apps/backend/kubedeck_backend/api/routes_clusters.py → apps/backend/kubedeck_backend/api/runtime.py
- `kubectl_status()` --calls--> `kubectl_error()`  [INFERRED]
  .kubedeck_patch_backup/1.0.5-20260617-143139/apps/backend/kubedeck_backend/api/routes_core.py → apps/backend/kubedeck_backend/api/runtime.py

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Kubectl Transport And Packaging Pattern** — readme_kubectl_cli, architecture_kubectl_runner, desktop_electron_builder_portable_package, readme_portable_kubectl_unbundling [INFERRED 0.95]
- **Watch Cache Live Refresh Pipeline** — architecture_watch_manager, architecture_resource_snapshot_cache, architecture_websocket_event_hub, changelog_watch_cache_websocket [INFERRED 0.95]
- **Local Security Model** — security_local_backend_exposure, api_session_token_authentication, security_redaction [INFERRED 0.85]

## Communities (90 total, 13 thin omitted)

### Community 0 - "cluster init KubectlCommand"
Cohesion: 0.07
Nodes (52): AppConfig, Any, HTTPException, KubectlCommand, Path, Path, BaseModel, Cluster (+44 more)

### Community 1 - "cluster cache audit"
Cohesion: 0.07
Nodes (55): clear_resource_snapshot_cache(), resource_snapshot_cache_stats(), audit_events(), clear_config_cache(), get_cached_config(), Any, Any, import_cluster() (+47 more)

### Community 2 - "watch stop all"
Cohesion: 0.06
Nodes (28): watch_start(), watch_status(), watch_stop(), watch_stop_all(), WatchStartRequest, event_matches_subscription(), Thread-safe fan-out hub for resource watch events.      kubectl watch reader t, WatchEventHub (+20 more)

### Community 3 - "bulkDeleteListText bulkDeleteNamespaceSummary tsx"
Cohesion: 0.08
Nodes (40): App(), bulkDeleteListText(), bulkDeleteNamespaceSummary(), useGlobalSearch(), useNamespaceRefresh(), usePersistUiState(), App(), BulkDeleteFailure (+32 more)

### Community 5 - "tsx AboutPanel global"
Cohesion: 0.08
Nodes (31): AboutPanel(), Props, Window, OperationConfirmation, AppConfig, AppFolder, AuditResponse, BackendInfo (+23 more)

### Community 6 - "resource cache invalidate"
Cohesion: 0.13
Nodes (29): affected_snapshot_namespaces(), apply_watch_event_line_to_resource_cache(), discovery_resource_definitions_key(), get_cached_discovery_resource_definitions(), invalidate_after_resource_action(), invalidate_after_yaml_apply(), invalidate_discovery_resource_definitions_cache(), invalidate_resource_snapshot_cache() (+21 more)

### Community 7 - "links pod endpoint"
Cohesion: 0.16
Nodes (34): binding_has_service_account_subject_raw(), build_related_links(), container_config_links(), dedupe_related_links(), endpoint_address_links(), endpoint_slice_address_detail(), endpoint_slice_address_links(), endpoint_slice_service_name() (+26 more)

### Community 8 - "BackendPidFile AppFolder BackendConfig"
Cohesion: 0.13
Nodes (30): appDataRoot(), AppFolder, appFolderPath(), BackendConfig, BackendPidFile, backendPidPath(), cleanupOldTerminalScripts(), cleanupStaleBackend() (+22 more)

### Community 9 - "ssh normalize session"
Cohesion: 0.12
Nodes (28): _command_preview(), _connect_client(), _load_private_key(), node_ssh_terminal(), _normalize_host(), _normalize_port(), _normalize_username(), _open_ssh_session() (+20 more)

### Community 10 - "react types xterm"
Cohesion: 0.06
Nodes (30): author, description, devDependencies, 7zip-bin, concurrently, electron, electron-builder, lucide-react (+22 more)

### Community 11 - "react types xterm"
Cohesion: 0.06
Nodes (30): author, description, devDependencies, 7zip-bin, concurrently, electron, electron-builder, lucide-react (+22 more)

### Community 12 - "SettingsPanel normalizeConfigSsh tsx"
Cohesion: 0.17
Nodes (24): normalizeConfigSsh(), SettingsPanel(), ClusterPanel(), ResourceCacheDiagnostics(), WatchDiagnostics(), normalizeConfigSsh(), normalizeConfigSsh(), SettingsPanel() (+16 more)

### Community 13 - "port forward local"
Cohesion: 0.17
Nodes (27): can_bind_local_port(), discover_external_port_forwards(), find_available_local_port(), is_kubectl_port_forward_process(), is_local_port_registered(), is_process_running(), load_port_forward_registry(), normalize_port_forward_local_port() (+19 more)

### Community 14 - "tsx CommandPalette HelpPanel"
Cohesion: 0.10
Nodes (17): BulkDeleteFailure, eventInvolvedLocator(), initialSection, NodeActionConfirmation, NodeActionKind, parseKindName(), readRowString(), resourceForKubernetesKind() (+9 more)

### Community 15 - "ResourceSummary tsx ResourceSummaryProps"
Cohesion: 0.13
Nodes (17): HIDDEN_RAW_FIELDS, isPodResource(), isProblemRestart(), numberValue(), primaryStatus(), ResourceSummary(), ResourceSummaryProps, RestartDiagnostic (+9 more)

### Community 16 - "tsx DescribeTab LogsTab"
Cohesion: 0.14
Nodes (19): DescribeTab(), DescribeTabProps, LogsTab(), LogsTabProps, DrawerTab, PodDrawer(), containerNames(), displayResource() (+11 more)

### Community 17 - "AuditPanel tsx PortForwardsPanel"
Cohesion: 0.14
Nodes (16): AuditPanel(), AuditStatusFilter, STATUS_FILTERS, PortForwardModalProps, PortForwardsPanel(), UseGlobalSearchOptions, UseNamespaceRefreshOptions, ApiError (+8 more)

### Community 18 - "resource secret deployment"
Cohesion: 0.18
Nodes (22): load_raw_items(), load_target_raw(), pod_yaml(), kubectl_error(), validate_identifier(), resource_events(), resource_related(), Any (+14 more)

### Community 19 - "ProblemsPanel tsx SeverityFilter"
Cohesion: 0.15
Nodes (15): advice(), categoryLabel(), GuidanceItem, normalizeSeverity(), problemAdvice(), ProblemCategory, problemDiagnosticText(), problemOpenLocator() (+7 more)

### Community 20 - "ResourceSummary tsx ResourceSummaryProps"
Cohesion: 0.13
Nodes (14): HIDDEN_RAW_FIELDS, isPodResource(), isProblemRestart(), keyFacts(), numberValue(), primaryStatus(), ResourceOverview(), ResourceSummary() (+6 more)

### Community 21 - "ResourceSummary tsx ResourceSummaryProps"
Cohesion: 0.14
Nodes (14): HIDDEN_RAW_FIELDS, isPodResource(), isProblemRestart(), keyFacts(), numberValue(), primaryStatus(), ResourceOverview(), ResourceSummary() (+6 more)

### Community 22 - "search resource matches"
Cohesion: 0.22
Nodes (20): cluster_search(), build_search_resource_specs(), crd_item_matches_definition(), deduplicate_search_results(), definition_matches_query(), fully_qualified_api_resource(), generic_summary(), get_cached_resource_definitions() (+12 more)

### Community 23 - "summary format pod"
Cohesion: 0.27
Nodes (20): Any, crd_summary(), deployment_summary(), event_summary(), format_bytes_quantity(), format_container_ports(), format_policy_rules(), format_subjects() (+12 more)

### Community 24 - "deployment secret logs"
Cohesion: 0.19
Nodes (17): deployment_log_targets(), deployment_logs_text(), load_deployment(), matching_deployment_pods(), selector_matches(), Any, deployment_log_target_list(), deployment_logs() (+9 more)

### Community 25 - "tsx initialSection BulkDeleteFailure"
Cohesion: 0.15
Nodes (13): PersistUiStateOptions, BulkDeleteFailure, eventInvolvedLocator(), initialSection, NodeActionConfirmation, NodeActionKind, parseKindName(), readRowString() (+5 more)

### Community 26 - "summary format role"
Cohesion: 0.29
Nodes (18): Any, crd_summary(), deployment_summary(), event_summary(), format_bytes_quantity(), format_container_ports(), format_policy_rules(), format_subjects() (+10 more)

### Community 27 - "routes auth action"
Cohesion: 0.15
Nodes (11): auth_check_for_action(), verify_auth_can_i(), pod_exec(), cluster_problems(), dry_run_yaml(), Any, Any, resource_action() (+3 more)

### Community 28 - "problem problems category"
Cohesion: 0.21
Nodes (16): build_problem_rows(), classify_problem(), count_by(), format_memory_metric(), impact_for_category(), parse_pod_metrics(), parse_ready_pair(), problem_row() (+8 more)

### Community 29 - "apply yaml target"
Cohesion: 0.16
Nodes (16): pod_logs(), apply_yaml(), Return kind, namespace, name, document_count for a single-object YAML apply payl, yaml_apply_target(), api_error(), ensure_payload_size(), normalize_tail_lines(), require_confirmation() (+8 more)

### Community 30 - "tsconfig renderer json"
Cohesion: 0.11
Nodes (17): compilerOptions, allowJs, allowSyntheticDefaultImports, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, lib (+9 more)

### Community 31 - "RelatedTab tsx RelatedTabProps"
Cohesion: 0.18
Nodes (11): dedupeRelatedLinks(), groupRelatedLinks(), ownerReferences(), RelatedResourceCard(), RelatedTab(), RelatedTabProps, relationClassName(), relationGroup() (+3 more)

### Community 32 - "Assert Install Ensure"
Cohesion: 0.28
Nodes (15): Assert-Winget(), Build-DesktopOnly(), Build-Portable(), Ensure-Prerequisites(), Ensure-Repository(), Get-NodeMajor(), Get-PythonVersion(), Install-ProjectDependencies() (+7 more)

### Community 33 - "Assert Install Ensure"
Cohesion: 0.28
Nodes (15): Assert-Winget(), Build-DesktopOnly(), Build-Portable(), Ensure-Prerequisites(), Ensure-Repository(), Get-NodeMajor(), Get-PythonVersion(), Install-ProjectDependencies() (+7 more)

### Community 34 - "ResourceTable HIDDEN COLUMNS"
Cohesion: 0.17
Nodes (13): Column, COMPACT_HIDDEN_COLUMNS, compactReason(), compareRows(), dateValue(), formatCell(), NARROW_HIDDEN_COLUMNS, PAGE_SIZE_OPTIONS (+5 more)

### Community 35 - "ResourceTable HIDDEN COLUMNS"
Cohesion: 0.17
Nodes (13): Column, COMPACT_HIDDEN_COLUMNS, compactReason(), compareRows(), dateValue(), formatCell(), NARROW_HIDDEN_COLUMNS, PAGE_SIZE_OPTIONS (+5 more)

### Community 36 - "ResourceTable HIDDEN COLUMNS"
Cohesion: 0.17
Nodes (13): Column, COMPACT_HIDDEN_COLUMNS, compactReason(), compareRows(), dateValue(), formatCell(), NARROW_HIDDEN_COLUMNS, PAGE_SIZE_OPTIONS (+5 more)

### Community 37 - "ResourceTable HIDDEN COLUMNS"
Cohesion: 0.17
Nodes (13): Column, COMPACT_HIDDEN_COLUMNS, compactReason(), compareRows(), dateValue(), formatCell(), NARROW_HIDDEN_COLUMNS, PAGE_SIZE_OPTIONS (+5 more)

### Community 38 - "ResourceTable HIDDEN COLUMNS"
Cohesion: 0.17
Nodes (13): Column, COMPACT_HIDDEN_COLUMNS, compactReason(), compareRows(), dateValue(), formatCell(), NARROW_HIDDEN_COLUMNS, PAGE_SIZE_OPTIONS (+5 more)

### Community 39 - "ResourceTable HIDDEN COLUMNS"
Cohesion: 0.17
Nodes (13): Column, COMPACT_HIDDEN_COLUMNS, compactReason(), compareRows(), dateValue(), formatCell(), NARROW_HIDDEN_COLUMNS, PAGE_SIZE_OPTIONS (+5 more)

### Community 40 - "ResourceTable HIDDEN COLUMNS"
Cohesion: 0.17
Nodes (13): Column, COMPACT_HIDDEN_COLUMNS, compactReason(), compareRows(), dateValue(), formatCell(), NARROW_HIDDEN_COLUMNS, PAGE_SIZE_OPTIONS (+5 more)

### Community 41 - "terminal pod WebSocket"
Cohesion: 0.23
Nodes (12): pod_terminal(), build_terminal_command(), consume_escape_input(), handle_pipe_input(), normalize_terminal_shell(), pod_terminal_pipes(), pod_terminal_pty(), terminal_pty_available() (+4 more)

### Community 42 - "PodDrawerModals tsx ResourceAction"
Cohesion: 0.21
Nodes (14): actionDescription(), actionLabel(), commandPreview(), quoteKubectlArg(), ResourceAction, ResourceActionConfirmModal(), ResourceActionConfirmModalProps, TerminalContainerPickerModal() (+6 more)

### Community 43 - "tsx Props CommandPreviewBlock"
Cohesion: 0.20
Nodes (10): CommandPreviewBlock(), Props, sanitizeCommandPreview(), buildErrorHints(), ErrorHints(), ErrorPanel(), Props, Props (+2 more)

### Community 44 - "NodeSshTab tsx AuthMethod"
Cohesion: 0.21
Nodes (8): AuthMethod, NodeSshTab(), NodeSshTabProps, normalizeAuthMethod(), normalizePort(), sshPreview(), TerminalMessage, terminalStatusClass()

### Community 45 - "package json name"
Cohesion: 0.17
Nodes (11): devDependencies, 7zip-bin, name, private, scripts, build, dev, package:win (+3 more)

### Community 46 - "resource cached cache"
Cohesion: 0.30
Nodes (12): apply_pod_metrics(), load_problem_resource(), get_cached_resource_list_response(), set_cached_resource_list_response(), pod_describe(), cluster_command(), resources(), resources() (+4 more)

### Community 47 - "EventsTab tsx EventTypeFilter"
Cohesion: 0.27
Nodes (11): EventCard(), eventInvolvedObject(), EventSortOrder, EventsTab(), EventsTabProps, eventTimeValue(), EventTypeFilter, parseKindName() (+3 more)

### Community 48 - "tsconfig json compilerOptions"
Cohesion: 0.17
Nodes (11): compilerOptions, esModuleInterop, module, moduleResolution, outDir, rootDir, skipLibCheck, strict (+3 more)

### Community 49 - "package json name"
Cohesion: 0.17
Nodes (11): devDependencies, 7zip-bin, name, private, scripts, build, dev, package:win (+3 more)

### Community 50 - "PortForwardModal tsx defaultPortForwardDraft"
Cohesion: 0.40
Nodes (10): addPortCandidates(), defaultPortForwardDraft(), portChoicesForRow(), portForwardLocalPreview(), PortForwardModal(), portForwardRemotePreview(), randomPortForwardPort(), suggestedLocalPort() (+2 more)

### Community 51 - "TerminalTab tsx TerminalShell"
Cohesion: 0.22
Nodes (5): shellCommandPreview(), TerminalShell, terminalStatusClass(), TerminalTab(), TerminalTabProps

### Community 53 - "YamlTab tsx YamlTabProps"
Cohesion: 0.33
Nodes (7): countMatches(), findYamlCommentIndex(), highlightYaml(), highlightYamlLine(), highlightYamlScalars(), YamlTab(), YamlTabProps

### Community 56 - "ResourceSummary tsx ResourceSummaryProps"
Cohesion: 0.43
Nodes (5): keyFacts(), primaryStatus(), ResourceOverview(), ResourceSummaryProps, singularResource()

### Community 57 - "index Theme Language"
Cohesion: 0.29
Nodes (6): Cluster, ErrorInfo, Language, LlmSettings, Settings, Theme

### Community 59 - "WatchEntry time parseTimestamp"
Cohesion: 0.60
Nodes (5): WatchEntry(), formatAge(), formatAgeAgo(), formatElapsed(), parseTimestamp()

### Community 60 - "kubectl KubeDeck Desktop"
Cohesion: 0.33
Nodes (6): Electron portable package, Backend, Desktop UI, Kubernetes CLI kubectl, KubeDeck, Portable kubectl unbundling

### Community 61 - "FastAPI backend Electron"
Cohesion: 0.40
Nodes (5): API error response contract, Electron main process, FastAPI backend, KubectlRunner and KubectlCommand, Process model

### Community 63 - "version ps1 Utf8NoBom"
Cohesion: 0.70
Nodes (4): Remove-Utf8BomIfPresent(), Update-PackageJsonVersion(), Update-PyProjectVersion(), Write-Utf8NoBom()

### Community 64 - "package json name"
Cohesion: 0.40
Nodes (4): name, private, types, version

### Community 65 - "package json name"
Cohesion: 0.40
Nodes (4): name, private, types, version

### Community 67 - "ResourceSnapshotCache Watch WebSocket"
Cohesion: 0.67
Nodes (3): ResourceSnapshotCache, Watch manager, WebSocket event hub

### Community 68 - "cache Watch WebSocket"
Cohesion: 0.67
Nodes (3): Related resources topology, Resource snapshot cache, Watch cache WebSocket live refresh

## Knowledge Gaps
- **243 isolated node(s):** `ImportClusterRequest`, `RenameClusterRequest`, `SettingsUpdateRequest`, `SecretRevealRequest`, `SecretCopyAuditRequest` (+238 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **13 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ResourceRow` connect `PodDrawerModals tsx ResourceAction` to `bulkDeleteListText bulkDeleteNamespaceSummary tsx`, `tsx AboutPanel global`, `tsx CommandPalette HelpPanel`, `ResourceSummary tsx ResourceSummaryProps`, `tsx DescribeTab LogsTab`, `AuditPanel tsx PortForwardsPanel`, `ProblemsPanel tsx SeverityFilter`, `ResourceSummary tsx ResourceSummaryProps`, `tsx initialSection BulkDeleteFailure`, `RelatedTab tsx RelatedTabProps`, `ResourceTable HIDDEN COLUMNS`, `ResourceTable HIDDEN COLUMNS`, `ResourceTable HIDDEN COLUMNS`, `ResourceTable HIDDEN COLUMNS`, `ResourceTable HIDDEN COLUMNS`, `ResourceTable HIDDEN COLUMNS`, `ResourceTable HIDDEN COLUMNS`, `tsx Props CommandPreviewBlock`, `NodeSshTab tsx AuthMethod`, `EventsTab tsx EventTypeFilter`, `PortForwardModal tsx defaultPortForwardDraft`, `TerminalTab tsx TerminalShell`, `kubeResources normalizeNamespaceSelection arraysEqual`, `kubeResources normalizeNamespaceSelection arraysEqual`, `ResourceSummary tsx ResourceSummaryProps`?**
  _High betweenness centrality (0.056) - this node is a cross-community bridge._
- **Why does `ApiClient` connect `ApiClient constructor health` to `bulkDeleteListText bulkDeleteNamespaceSummary tsx`, `tsx AboutPanel global`, `tsx Props CommandPreviewBlock`, `SettingsPanel normalizeConfigSsh tsx`, `NodeSshTab tsx AuthMethod`, `tsx CommandPalette HelpPanel`, `tsx DescribeTab LogsTab`, `AuditPanel tsx PortForwardsPanel`, `ProblemsPanel tsx SeverityFilter`, `kubeResources normalizeNamespaceSelection arraysEqual`, `TerminalTab tsx TerminalShell`, `kubeResources normalizeNamespaceSelection arraysEqual`, `tsx initialSection BulkDeleteFailure`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Why does `cluster_command()` connect `resource cached cache` to `cluster init KubectlCommand`, `cluster cache audit`, `watch stop all`, `terminal pod WebSocket`, `resource secret deployment`, `search resource matches`, `deployment secret logs`, `routes auth action`, `apply yaml target`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Are the 35 inferred relationships involving `validate_identifier()` (e.g. with `node_ssh_terminal()` and `pod_describe()`) actually correct?**
  _`validate_identifier()` has 35 INFERRED edges - model-reasoned connections that need verification._
- **Are the 33 inferred relationships involving `kubectl_error()` (e.g. with `verify_auth_can_i()` and `pod_describe()`) actually correct?**
  _`kubectl_error()` has 33 INFERRED edges - model-reasoned connections that need verification._
- **Are the 30 inferred relationships involving `cluster_command()` (e.g. with `verify_auth_can_i()` and `apply_pod_metrics()`) actually correct?**
  _`cluster_command()` has 30 INFERRED edges - model-reasoned connections that need verification._
- **What connects `ImportClusterRequest`, `RenameClusterRequest`, `SettingsUpdateRequest` to the rest of the system?**
  _255 weakly-connected nodes found - possible documentation gaps or missing edges._