import { useEffect, useRef, useState } from "react";
import type { ApiClient } from "../api";
import type { ErrorInfo, GlobalSearchItem } from "../types";
import { asErrorInfo, isAbortError } from "../utils/errors";

interface UseGlobalSearchOptions {
  api: ApiClient | null;
  activeClusterId?: string;
  namespace: string;
  onError: (error: ErrorInfo) => void;
}

export function useGlobalSearch({ api, activeClusterId, namespace, onError }: UseGlobalSearchOptions) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<GlobalSearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    function handleGlobalShortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
        return;
      }
      if (!isTyping && event.key === "/") {
        event.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", handleGlobalShortcut);
    return () => window.removeEventListener("keydown", handleGlobalShortcut);
  }, []);

  useEffect(() => {
    if (!api || !activeClusterId || !open) {
      abortRef.current?.abort();
      setLoading(false);
      return;
    }

    const trimmed = query.trim();
    if (trimmed.length < 2) {
      abortRef.current?.abort();
      setResults([]);
      setLoading(false);
      return;
    }

    const requestId = seqRef.current + 1;
    seqRef.current = requestId;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);

    const timer = window.setTimeout(() => {
      api.search(activeClusterId, trimmed, namespace, 120, true, controller.signal)
        .then((response) => {
          if (seqRef.current !== requestId) return;
          setResults(response.items);
        })
        .catch((err) => {
          if (isAbortError(err) || seqRef.current !== requestId) return;
          setResults([]);
          onError(asErrorInfo(err));
        })
        .finally(() => {
          if (seqRef.current === requestId) setLoading(false);
        });
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [api, activeClusterId, open, query, namespace, onError]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  return {
    query,
    setQuery,
    open,
    setOpen,
    results,
    loading,
  };
}
