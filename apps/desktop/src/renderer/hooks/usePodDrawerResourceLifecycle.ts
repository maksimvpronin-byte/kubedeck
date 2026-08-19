import { useEffect, useRef, useState } from "react";
import { ApiClient } from "../api";
import type { ErrorInfo, RelatedLink, ResourceRow, ServiceEndpointsResponse, UsageHistoryResponse } from "../types";
import type { DrawerTab } from "../components/PodDrawerChrome";
import { isAbortError } from "../components/podDrawerHelpers";
import { toErrorInfo } from "../utils/errors";

// Matches the sampling interval: refreshing faster only re-reads the same
// numbers, refreshing slower leaves a visible lag behind the recorded data.
const USAGE_HISTORY_REFRESH_MS = 30_000;

interface Options {
  api: ApiClient;
  clusterId: string;
  pod: ResourceRow | null;
  resource: string;
  tab: DrawerTab;
  currentObjectKey: string;
}

export function createDrawerRequestGuard() {
  let generation = 0;
  return {
    next: () => ++generation,
    invalidate: () => {
      generation += 1;
    },
    isCurrent: (candidate: number) => candidate === generation,
  };
}

export function drawerResourceResetSnapshot() {
  return {
    content: "",
    describeContent: "",
    yamlBaseline: "",
    yamlDraft: "",
    yamlObjectKey: "",
    events: [] as ResourceRow[],
    relatedLinks: [] as RelatedLink[],
    relatedSources: {} as Record<string, number>,
    relatedErrors: [] as Array<ErrorInfo & { resource?: string; namespace?: string }>,
    metrics: {} as ResourceRow,
    serviceEndpoints: null as ServiceEndpointsResponse | null,
    usageHistory: null as UsageHistoryResponse | null,
  };
}

export function isServiceResource(resource: string): boolean {
  return ["service", "services", "svc"].includes(resource.toLocaleLowerCase());
}

export function isPodResource(resource: string): boolean {
  return ["pod", "pods", "po"].includes(resource.toLocaleLowerCase());
}

export function drawerResourceIdentity(clusterId: string, resource: string, row: ResourceRow | null) {
  if (!row) return "";
  return `${clusterId}:${resource}:${String(row.namespace || "_cluster")}:${row.name}:${row.uid ? String(row.uid) : ""}`;
}

function drawerError(error: unknown): ErrorInfo {
  return toErrorInfo(error);
}

export function usePodDrawerResourceLifecycle({ api, clusterId, pod, resource, tab, currentObjectKey }: Options) {
  const requestGuardRef = useRef(createDrawerRequestGuard());
  const metricsRequestRef = useRef(0);
  const endpointsRequestRef = useRef(0);
  const usageHistoryRequestRef = useRef(0);
  const [content, setContent] = useState("");
  const [describeContent, setDescribeContent] = useState("");
  const [yamlBaseline, setYamlBaseline] = useState("");
  const [yamlDraft, setYamlDraft] = useState("");
  const [yamlObjectKey, setYamlObjectKey] = useState("");
  const [events, setEvents] = useState<ResourceRow[]>([]);
  const [relatedLinks, setRelatedLinks] = useState<RelatedLink[]>([]);
  const [relatedSources, setRelatedSources] = useState<Record<string, number>>({});
  const [relatedErrors, setRelatedErrors] = useState<Array<ErrorInfo & { resource?: string; namespace?: string }>>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [metrics, setMetrics] = useState<ResourceRow>({ uid: "", name: "" });
  const [serviceEndpoints, setServiceEndpoints] = useState<ServiceEndpointsResponse | null>(null);
  const [usageHistory, setUsageHistory] = useState<UsageHistoryResponse | null>(null);
  const [usageHistoryTick, setUsageHistoryTick] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [snapshotObjectKey, setSnapshotObjectKey] = useState(currentObjectKey);

  const podName = pod?.name ?? "";
  const podNamespace = pod ? String(pod.namespace || "_cluster") : "";

  useEffect(() => {
    void currentObjectKey;
    requestGuardRef.current.invalidate();
    metricsRequestRef.current += 1;
    endpointsRequestRef.current += 1;
    usageHistoryRequestRef.current += 1;
    const reset = drawerResourceResetSnapshot();
    setContent(reset.content);
    setDescribeContent(reset.describeContent);
    setYamlBaseline(reset.yamlBaseline);
    setYamlDraft(reset.yamlDraft);
    setYamlObjectKey(reset.yamlObjectKey);
    setEvents(reset.events);
    setRelatedLinks(reset.relatedLinks);
    setRelatedSources(reset.relatedSources);
    setRelatedErrors(reset.relatedErrors);
    setMetrics(reset.metrics);
    setServiceEndpoints(reset.serviceEndpoints);
    setUsageHistory(reset.usageHistory);
    setRelatedLoading(false);
    setLoading(false);
    setError(null);
    setSnapshotObjectKey(currentObjectKey);
  }, [currentObjectKey]);

  useEffect(() => {
    if (!currentObjectKey || tab === "summary" || tab === "llm" || tab === "events" || tab === "related" || tab === "logs" || tab === "secret") {
      if (tab !== "yaml") setError(null);
      return;
    }
    if (tab === "yaml" && yamlObjectKey === currentObjectKey) {
      setError(null);
      return;
    }

    const controller = new AbortController();
    const requestGeneration = requestGuardRef.current.next();
    setLoading(true);
    setError(null);
    api
      .resourceText(clusterId, resource, podNamespace, podName, tab, controller.signal)
      .then((text) => {
        if (controller.signal.aborted || !requestGuardRef.current.isCurrent(requestGeneration)) return;
        if (tab === "yaml") {
          setYamlBaseline(text);
          setYamlDraft(text);
          setYamlObjectKey(currentObjectKey);
        } else {
          setContent(text);
          if (tab === "describe") setDescribeContent(text);
        }
      })
      .catch((cause) => {
        if (!isAbortError(cause)) setError(drawerError(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted && requestGuardRef.current.isCurrent(requestGeneration)) setLoading(false);
      });
    return () => controller.abort();
  }, [api, clusterId, podName, podNamespace, resource, tab, currentObjectKey, yamlObjectKey]);

  useEffect(() => {
    if (!currentObjectKey || (tab !== "summary" && tab !== "llm")) return;
    const controller = new AbortController();
    const requestGeneration = requestGuardRef.current.next();
    setLoading(true);
    setError(null);
    api
      .resourceEvents(clusterId, resource, podNamespace, podName, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted && requestGuardRef.current.isCurrent(requestGeneration)) setEvents(response.items);
      })
      .catch((cause) => {
        if (!isAbortError(cause)) setError(drawerError(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted && requestGuardRef.current.isCurrent(requestGeneration)) setLoading(false);
      });
    return () => controller.abort();
  }, [api, clusterId, podName, podNamespace, resource, tab, currentObjectKey]);

  useEffect(() => {
    if (!currentObjectKey || tab !== "summary" || !["node", "nodes"].includes(resource)) return;
    const controller = new AbortController();
    const requestGeneration = ++metricsRequestRef.current;
    api
      .resourceMetrics(clusterId, resource, podNamespace, podName, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted && requestGeneration === metricsRequestRef.current) setMetrics(response);
      })
      .catch((cause) => {
        if (!isAbortError(cause) && requestGeneration === metricsRequestRef.current) setError(drawerError(cause));
      });
    return () => {
      controller.abort();
      metricsRequestRef.current += 1;
    };
  }, [api, clusterId, podName, podNamespace, resource, tab, currentObjectKey]);

  // Endpoints live in EndpointSlices rather than on the Service itself, so the
  // summary asks for them separately. A cluster that refuses the lookup (RBAC,
  // no EndpointSlice API) leaves the rest of the summary intact.
  useEffect(() => {
    if (!currentObjectKey || tab !== "summary" || !isServiceResource(resource)) return;
    const controller = new AbortController();
    const requestGeneration = ++endpointsRequestRef.current;
    api
      .serviceEndpoints(clusterId, resource, podNamespace, podName, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted && requestGeneration === endpointsRequestRef.current) setServiceEndpoints(response);
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
      endpointsRequestRef.current += 1;
    };
  }, [api, clusterId, podName, podNamespace, resource, tab, currentObjectKey]);

  // History grows while the drawer stays open, and none of the fetch's other
  // dependencies ever change, so without this tick the panel would keep
  // showing whatever it read when the tab was opened - including the "no
  // samples yet" message for a pod whose first samples have since arrived.
  useEffect(() => {
    if (!currentObjectKey || (tab !== "summary" && tab !== "llm") || !isPodResource(resource)) return;
    const timer = setInterval(() => setUsageHistoryTick((current) => current + 1), USAGE_HISTORY_REFRESH_MS);
    return () => clearInterval(timer);
  }, [currentObjectKey, tab, resource]);

  // Usage history is recorded by KubeDeck itself, so this reads what has
  // already been sampled and never touches the cluster. It is also loaded for
  // the LLM tab, which sends the same numbers along for the analysis.
  useEffect(() => {
    // The tick is a re-run trigger, not an input: reading it here is what keeps
    // it an honest dependency rather than one the linter treats as redundant.
    void usageHistoryTick;
    if (!currentObjectKey || (tab !== "summary" && tab !== "llm") || !isPodResource(resource)) return;
    const controller = new AbortController();
    const requestGeneration = ++usageHistoryRequestRef.current;
    api
      .usageHistory(clusterId, resource, podNamespace, podName, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted && requestGeneration === usageHistoryRequestRef.current) setUsageHistory(response);
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
      usageHistoryRequestRef.current += 1;
    };
  }, [api, clusterId, podName, podNamespace, resource, tab, currentObjectKey, usageHistoryTick]);

  useEffect(() => {
    if (!currentObjectKey || tab !== "related") return;
    const controller = new AbortController();
    const requestGeneration = requestGuardRef.current.next();
    setRelatedLoading(true);
    setError(null);
    setRelatedSources({});
    setRelatedErrors([]);
    api
      .relatedResources(clusterId, resource, podNamespace, podName, controller.signal)
      .then((response) => {
        if (controller.signal.aborted || !requestGuardRef.current.isCurrent(requestGeneration)) return;
        setRelatedLinks(response.items);
        setRelatedSources(response.sources || {});
        setRelatedErrors(response.errors || []);
      })
      .catch((cause) => {
        if (!isAbortError(cause)) setError(drawerError(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted && requestGuardRef.current.isCurrent(requestGeneration)) setRelatedLoading(false);
      });
    return () => controller.abort();
  }, [api, clusterId, podName, podNamespace, resource, tab, currentObjectKey]);

  const snapshotIsCurrent = snapshotObjectKey === currentObjectKey;

  return {
    content: snapshotIsCurrent ? content : "",
    setContent,
    describeContent: snapshotIsCurrent ? describeContent : "",
    setDescribeContent,
    yamlBaseline: snapshotIsCurrent ? yamlBaseline : "",
    setYamlBaseline,
    yamlDraft: snapshotIsCurrent ? yamlDraft : "",
    setYamlDraft,
    yamlObjectKey: snapshotIsCurrent ? yamlObjectKey : "",
    setYamlObjectKey,
    events: snapshotIsCurrent ? events : [],
    setEvents,
    relatedLinks: snapshotIsCurrent ? relatedLinks : [],
    setRelatedLinks,
    relatedSources: snapshotIsCurrent ? relatedSources : {},
    setRelatedSources,
    relatedErrors: snapshotIsCurrent ? relatedErrors : [],
    setRelatedErrors,
    relatedLoading: snapshotIsCurrent && relatedLoading,
    setRelatedLoading,
    metrics: snapshotIsCurrent ? metrics : { uid: "", name: "" },
    serviceEndpoints: snapshotIsCurrent ? serviceEndpoints : null,
    usageHistory: snapshotIsCurrent ? usageHistory : null,
    loading: snapshotIsCurrent && loading,
    setLoading,
    error: snapshotIsCurrent ? error : null,
    setError,
  };
}
