import { useCallback, useEffect, useRef, useState } from "react";
import { createAsyncActionFeedbackController, type AsyncActionFeedbackController, type AsyncActionPhase, type AsyncActionResult } from "../utils/asyncActionFeedback";

export interface AsyncActionFeedback {
  phase: AsyncActionPhase;
  run: (action: () => AsyncActionResult | Promise<AsyncActionResult>) => Promise<boolean>;
  start: () => boolean;
  complete: (successful: boolean) => Promise<boolean>;
}

export function useAsyncActionFeedback(): AsyncActionFeedback {
  const [phase, setPhase] = useState<AsyncActionPhase>("idle");
  const controllerRef = useRef<AsyncActionFeedbackController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createAsyncActionFeedbackController({ onPhaseChange: setPhase });
  }

  useEffect(() => {
    const controller = controllerRef.current;
    return () => controller?.dispose();
  }, []);

  const run = useCallback((action: () => AsyncActionResult | Promise<AsyncActionResult>) => {
    return controllerRef.current?.run(action) ?? Promise.resolve(false);
  }, []);
  const start = useCallback(() => controllerRef.current?.start() ?? false, []);
  const complete = useCallback((successful: boolean) => {
    return controllerRef.current?.complete(successful) ?? Promise.resolve(false);
  }, []);

  return { phase, run, start, complete };
}

export function useControlledAsyncActionFeedback(
  busy: boolean,
  failed: boolean,
): {
  phase: AsyncActionPhase;
  trigger: (action: () => void) => void;
} {
  const feedback = useAsyncActionFeedback();
  const controlledRef = useRef(false);
  const observedBusyRef = useRef(false);

  useEffect(() => {
    if (!controlledRef.current) return;
    if (busy) {
      observedBusyRef.current = true;
      return;
    }
    if (!observedBusyRef.current) return;
    controlledRef.current = false;
    observedBusyRef.current = false;
    void feedback.complete(!failed);
  }, [busy, failed, feedback.complete]);

  const trigger = useCallback(
    (action: () => void) => {
      if (!feedback.start()) return;
      controlledRef.current = true;
      observedBusyRef.current = false;
      action();
    },
    [feedback.start],
  );

  return { phase: feedback.phase, trigger };
}
