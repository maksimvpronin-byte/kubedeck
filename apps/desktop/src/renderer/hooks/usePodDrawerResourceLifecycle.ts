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

  const podUid = pod?.uid ? String(pod.uid) : "";
  const podName = pod?.name ?? "";
  const podNamespace = pod ? String(pod.namespace || "_cluster") : "";
  const resourceIdentity = `${podUid}:${resource}`;
  const yamlChanged = yamlDraft !== yamlBaseline;

  useEffect(() => {
    void resourceIdentity;
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
  }, [resourceIdentity]);

  useEffect(() => {
    if (!pod || tab === "summary" || tab === "llm" || tab === "events" || tab === "related" || tab === "terminal" || tab === "logs" || tab === "secret") {
      if (tab !== "yaml") setError(null);
      return;
    }
    if (tab === "yaml" && yamlObjectKey === currentObjectKey && yamlChanged) {
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
  }, [api, clusterId, pod, podName, podNamespace, resource, tab, currentObjectKey, yamlObjectKey, yamlChanged]);

  useEffect(() => {
    if (!pod || tab !== "events") return;
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
  }, [api, clusterId, pod, podName, podNamespace, resource, tab]);

  useEffect(() => {
    if (!pod || tab !== "related") return;
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
  }, [api, clusterId, pod, podName, podNamespace, resource, tab]);

  return {
    content,
    setContent,
    describeContent,
    setDescribeContent,
    yamlBaseline,
    setYamlBaseline,
    yamlDraft,
    setYamlDraft,
    yamlObjectKey,
    setYamlObjectKey,
    events,
    setEvents,
    relatedLinks,
    setRelatedLinks,
    relatedSources,
    setRelatedSources,
    relatedErrors,
    setRelatedErrors,
    relatedLoading,
    setRelatedLoading,
    loading,
    setLoading,
    error,
    setError,
  };
}
