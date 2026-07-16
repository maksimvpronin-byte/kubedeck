import { useEffect, useRef, useState } from "react";
import { ApiClient } from "../api";
import type { ErrorInfo, RelatedLink, ResourceRow } from "../types";
import type { DrawerTab } from "../components/PodDrawerChrome";
import { isAbortError } from "../components/podDrawerHelpers";
import { toErrorInfo } from "../utils/errors";

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
  };
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [snapshotObjectKey, setSnapshotObjectKey] = useState(currentObjectKey);

  const podName = pod?.name ?? "";
  const podNamespace = pod ? String(pod.namespace || "_cluster") : "";

  useEffect(() => {
    void currentObjectKey;
    requestGuardRef.current.invalidate();
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
    setRelatedLoading(false);
    setLoading(false);
    setError(null);
    setSnapshotObjectKey(currentObjectKey);
  }, [currentObjectKey]);

  useEffect(() => {
    if (!currentObjectKey || tab === "summary" || tab === "llm" || tab === "events" || tab === "related" || tab === "terminal" || tab === "logs" || tab === "secret") {
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
    if (!currentObjectKey || tab !== "events") return;
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
    loading: snapshotIsCurrent && loading,
    setLoading,
    error: snapshotIsCurrent ? error : null,
    setError,
  };
}
