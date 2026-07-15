export type AsyncActionPhase = "idle" | "pending" | "success" | "error";
export type AsyncActionResult = void | boolean;

export interface AsyncActionScheduler {
  now: () => number;
  setTimeout: (callback: () => void, delay: number) => number;
  clearTimeout: (timer: number) => void;
}

export interface AsyncActionFeedbackController {
  phase: () => AsyncActionPhase;
  start: () => boolean;
  complete: (successful: boolean) => Promise<boolean>;
  run: (action: () => AsyncActionResult | Promise<AsyncActionResult>) => Promise<boolean>;
  dispose: () => void;
}

export const ASYNC_ACTION_MIN_PENDING_MS = 300;
export const ASYNC_ACTION_SUCCESS_MS = 700;
export const ASYNC_ACTION_ERROR_MS = 1000;

export function createAsyncActionFeedbackController({
  onPhaseChange,
  scheduler = browserScheduler(),
  minimumPendingMs = ASYNC_ACTION_MIN_PENDING_MS,
  successMs = ASYNC_ACTION_SUCCESS_MS,
  errorMs = ASYNC_ACTION_ERROR_MS,
}: {
  onPhaseChange: (phase: AsyncActionPhase) => void;
  scheduler?: AsyncActionScheduler;
  minimumPendingMs?: number;
  successMs?: number;
  errorMs?: number;
}): AsyncActionFeedbackController {
  let currentPhase: AsyncActionPhase = "idle";
  let startedAt = 0;
  let active = false;
  let disposed = false;
  let resetTimer: number | null = null;
  const pendingDelays = new Set<{ timer: number; resolve: () => void }>();

  const emit = (phase: AsyncActionPhase) => {
    if (disposed) return;
    currentPhase = phase;
    onPhaseChange(phase);
  };

  const clearReset = () => {
    if (resetTimer === null) return;
    scheduler.clearTimeout(resetTimer);
    resetTimer = null;
  };

  const wait = (delay: number) =>
    new Promise<void>((resolve) => {
      if (delay <= 0 || disposed) {
        resolve();
        return;
      }
      const entry = {
        timer: 0,
        resolve: () => {
          pendingDelays.delete(entry);
          resolve();
        },
      };
      entry.timer = scheduler.setTimeout(entry.resolve, delay);
      pendingDelays.add(entry);
    });

  const start = () => {
    if (active || disposed) return false;
    clearReset();
    active = true;
    startedAt = scheduler.now();
    emit("pending");
    return true;
  };

  const complete = async (successful: boolean) => {
    if (!active || disposed) return false;
    await wait(Math.max(0, minimumPendingMs - (scheduler.now() - startedAt)));
    if (disposed) return successful;
    active = false;
    const resultPhase = successful ? "success" : "error";
    emit(resultPhase);
    resetTimer = scheduler.setTimeout(
      () => {
        resetTimer = null;
        emit("idle");
      },
      successful ? successMs : errorMs,
    );
    return successful;
  };

  const run = async (action: () => AsyncActionResult | Promise<AsyncActionResult>) => {
    if (!start()) return false;
    let successful = false;
    try {
      successful = (await action()) !== false;
    } catch {
      successful = false;
    }
    return complete(successful);
  };

  return {
    phase: () => currentPhase,
    start,
    complete,
    run,
    dispose: () => {
      disposed = true;
      active = false;
      clearReset();
      for (const entry of pendingDelays) {
        scheduler.clearTimeout(entry.timer);
        entry.resolve();
      }
      pendingDelays.clear();
    },
  };
}

function browserScheduler(): AsyncActionScheduler {
  return {
    now: () => Date.now(),
    setTimeout: (callback, delay) => window.setTimeout(callback, delay),
    clearTimeout: (timer) => window.clearTimeout(timer),
  };
}
