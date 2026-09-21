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
  const [notice, setNotice] = useState<"partial" | "limited" | "failed" | null>(null);
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
    // Invalidate even when the query is cleared or the palette is closed.
    // Cancellation alone cannot retract a response that has already resolved.
    const requestId = ++seqRef.current;
    abortRef.current?.abort();
    setResults([]);
    setNotice(null);
    if (!api || !activeClusterId || !open) {
      setLoading(false);
      return;
    }

    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);

    const timer = window.setTimeout(() => {
      api
        .search(activeClusterId, trimmed, namespace, 120, true, controller.signal)
        .then((response) => {
          if (controller.signal.aborted || seqRef.current !== requestId) return;
          setResults(response.items);
          setNotice(response.errors.length || response.summary.errors ? "partial" : response.summary.limited ? "limited" : null);
        })
        .catch((err) => {
          if (controller.signal.aborted || isAbortError(err) || seqRef.current !== requestId) return;
          setResults([]);
          setNotice("failed");
          onError(asErrorInfo(err));
        })
        .finally(() => {
          if (!controller.signal.aborted && seqRef.current === requestId) setLoading(false);
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
    notice,
  };
}
