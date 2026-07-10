import { useEffect, useState } from "react";
import { ApiClient, ApiError } from "../api";
import type { ErrorInfo, RelatedLink, ResourceRow } from "../types";
import type { DrawerTab } from "../components/PodDrawerChrome";
import { isAbortError } from "../components/podDrawerHelpers";

interface Options {
  api: ApiClient;
  clusterId: string;
  pod: ResourceRow | null;
  resource: string;
  tab: DrawerTab;
  currentObjectKey: string;
}

function drawerError(error: unknown): ErrorInfo {
  return error instanceof ApiError
    ? error.info
    : { code: "ERROR", message: String(error), rawStderr: "", commandPreview: "" };
}

export function usePodDrawerResourceLifecycle({ api, clusterId, pod, resource, tab, currentObjectKey }: Options) {
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
  const yamlChanged = yamlDraft !== yamlBaseline;

  useEffect(() => {
    setContent("");
    setDescribeContent("");
    setYamlBaseline("");
    setYamlDraft("");
    setYamlObjectKey("");
    setEvents([]);
    setRelatedLinks([]);
    setRelatedSources({});
    setRelatedErrors([]);
    setRelatedLoading(false);
    setLoading(false);
    setError(null);
  }, [podUid, resource]);

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
    setLoading(true);
    setError(null);
    api.resourceText(clusterId, resource, podNamespace, podName, tab, controller.signal)
      .then((text) => {
        if (controller.signal.aborted) return;
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
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [api, clusterId, pod, podUid, podName, podNamespace, resource, tab, currentObjectKey, yamlObjectKey, yamlChanged]);

  useEffect(() => {
    if (!pod || tab !== "events") return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api.resourceEvents(clusterId, resource, podNamespace, podName, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) setEvents(response.items);
      })
      .catch((cause) => {
        if (!isAbortError(cause)) setError(drawerError(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [api, clusterId, pod, podUid, podName, podNamespace, resource, tab]);

  useEffect(() => {
    if (!pod || tab !== "related") return;
    const controller = new AbortController();
    setRelatedLoading(true);
    setError(null);
    setRelatedSources({});
    setRelatedErrors([]);
    api.relatedResources(clusterId, resource, podNamespace, podName, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        setRelatedLinks(response.items);
        setRelatedSources(response.sources || {});
        setRelatedErrors(response.errors || []);
      })
      .catch((cause) => {
        if (!isAbortError(cause)) setError(drawerError(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setRelatedLoading(false);
      });
    return () => controller.abort();
  }, [api, clusterId, pod, podUid, podName, podNamespace, resource, tab]);

  return {
    content, setContent,
    describeContent, setDescribeContent,
    yamlBaseline, setYamlBaseline,
    yamlDraft, setYamlDraft,
    yamlObjectKey, setYamlObjectKey,
    events, setEvents,
    relatedLinks, setRelatedLinks,
    relatedSources, setRelatedSources,
    relatedErrors, setRelatedErrors,
    relatedLoading, setRelatedLoading,
    loading, setLoading,
    error, setError,
  };
}
