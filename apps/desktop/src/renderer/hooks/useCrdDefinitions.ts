import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ApiClient } from "../api";
import type { ErrorInfo, ResourceRow } from "../types";
import { asErrorInfo, isAbortError } from "../utils/errors";

interface UseCrdDefinitionsOptions {
  api: ApiClient | null;
  clusterId?: string;
  // Whether the rows already hold this cluster's definitions.
  loaded: boolean;
  setRows: Dispatch<SetStateAction<Record<string, ResourceRow[]>>>;
  onError: (error: ErrorInfo) => void;
}

// The CRD list feeds the navigation tree and the palette of whichever cluster
// is active. A cluster left before its list arrived must not publish it - its
// definitions would show up under the next cluster, and its error in place of
// that cluster's state - so the request belongs to the cluster it was made for
// and is cancelled with it.
export function useCrdDefinitions({ api, clusterId, loaded, setRows, onError }: UseCrdDefinitionsOptions) {
  const loadedClusterRef = useRef<string | null>(null);
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (!api || !clusterId) return undefined;
    if (loadedClusterRef.current === clusterId && loadedRef.current) return undefined;
    loadedClusterRef.current = clusterId;
    const controller = new AbortController();
    let settled = false;
    api
      .resources(clusterId, "customresourcedefinitions", "_cluster", controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        settled = true;
        setRows((current) => ({ ...current, customresourcedefinitions: response.items }));
      })
      .catch((err) => {
        if (controller.signal.aborted || isAbortError(err)) return;
        settled = true;
        loadedClusterRef.current = null;
        onErrorRef.current(asErrorInfo(err));
      });
    return () => {
      if (settled) return;
      controller.abort();
      // Unfinished, so nothing was loaded: coming back has to ask again.
      if (loadedClusterRef.current === clusterId) loadedClusterRef.current = null;
    };
  }, [api, clusterId, setRows]);
}
