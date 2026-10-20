import { useCallback, useEffect, useRef, useState } from "react";
import type { ErrorInfo } from "../types";

export interface LlmAnswer {
  answer: string;
  model: string;
  elapsedMs: number;
  contextChars: number;
  truncated: boolean;
}

export interface PodDrawerLlmState extends LlmAnswer {
  loading: boolean;
  error: ErrorInfo | null;
  setLoading: (value: boolean) => void;
  setError: (error: ErrorInfo | null) => void;
  setAnswer: (value: LlmAnswer) => void;
}

const EMPTY: LlmAnswer = { answer: "", model: "", elapsedMs: 0, contextChars: 0, truncated: false };

// An analysis belongs to the object it was run against: moving the drawer to
// another object has to clear it, or the previous pod's answer stays on screen
// under the new pod's name.
export function usePodDrawerLlm(currentObjectKey: string): PodDrawerLlmState {
  const [loading, setLoadingState] = useState(false);
  const [error, setErrorState] = useState<ErrorInfo | null>(null);
  const [result, setResult] = useState<LlmAnswer>(EMPTY);
  // The object an analysis was started for. The tab that starts it can be
  // unmounted (another tab opened, another object selected) while this state
  // lives on, so the check that the answer still belongs here is made here:
  // an answer, error or end of loading for another object is dropped.
  const keyRef = useRef(currentObjectKey);
  keyRef.current = currentObjectKey;
  const requestKeyRef = useRef(currentObjectKey);

  useEffect(() => {
    setLoadingState(false);
    setErrorState(null);
    setResult(EMPTY);
  }, [currentObjectKey]);

  const setLoading = useCallback((value: boolean) => {
    if (value) requestKeyRef.current = keyRef.current;
    else if (requestKeyRef.current !== keyRef.current) return;
    setLoadingState(value);
  }, []);
  const setError = useCallback((value: ErrorInfo | null) => {
    if (value && requestKeyRef.current !== keyRef.current) return;
    setErrorState(value);
  }, []);
  const setAnswer = useCallback((value: LlmAnswer) => {
    if (requestKeyRef.current !== keyRef.current) return;
    setResult(value);
  }, []);

  return { ...result, loading, error, setLoading, setError, setAnswer };
}
