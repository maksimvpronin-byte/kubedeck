import { useCallback, useEffect, useState } from "react";
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [result, setResult] = useState<LlmAnswer>(EMPTY);

  useEffect(() => {
    setLoading(false);
    setError(null);
    setResult(EMPTY);
  }, [currentObjectKey]);

  const setAnswer = useCallback((value: LlmAnswer) => setResult(value), []);

  return { ...result, loading, error, setLoading, setError, setAnswer };
}
