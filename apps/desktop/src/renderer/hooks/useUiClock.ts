import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { formatElapsed } from "../utils/time";

type Listener = () => void;

interface Clock {
  now: number;
  listeners: Set<Listener>;
  timer: number | undefined;
}

// One timer per tick rate, however many components read it. A table showing an
// age column has one reader per row, and a timer each would have been hundreds
// of timers for one second hand.
const clocks = new Map<number, Clock>();

// Truncated to the tick so two reads inside the same tick answer the same
// number. Everything reading this clock formats an elapsed time in whole
// seconds, so nothing loses precision, and a snapshot that is stable between
// ticks is what lets a subscriber skip a render it does not need.
function tickNow(intervalMs: number): number {
  return Math.floor(Date.now() / intervalMs) * intervalMs;
}

function clockFor(intervalMs: number): Clock {
  const existing = clocks.get(intervalMs);
  if (existing) return existing;
  const clock: Clock = { now: tickNow(intervalMs), listeners: new Set(), timer: undefined };
  clocks.set(intervalMs, clock);
  return clock;
}

function clockNow(intervalMs: number): number {
  const clock = clockFor(intervalMs);
  // While nothing is subscribed the clock stands still, so a reader that
  // arrives after a pause would otherwise start on a stale second.
  if (clock.timer === undefined) clock.now = tickNow(intervalMs);
  return clock.now;
}

function subscribeUiClock(intervalMs: number, listener: Listener): () => void {
  const clock = clockFor(intervalMs);
  clock.listeners.add(listener);
  if (clock.timer === undefined) {
    clock.now = tickNow(intervalMs);
    clock.timer = window.setInterval(() => {
      clock.now = tickNow(intervalMs);
      for (const notify of [...clock.listeners]) notify();
    }, intervalMs);
  }
  return () => {
    clock.listeners.delete(listener);
    if (clock.listeners.size === 0 && clock.timer !== undefined) {
      window.clearInterval(clock.timer);
      clock.timer = undefined;
    }
  };
}

export function useUiClock(enabled = true, intervalMs = 1000): number {
  const [now, setNow] = useState(() => clockNow(intervalMs));

  useEffect(() => {
    if (!enabled) return;
    setNow(clockNow(intervalMs));
    return subscribeUiClock(intervalMs, () => setNow(clockNow(intervalMs)));
  }, [enabled, intervalMs]);

  return now;
}

// The age of one row, formatted. A row that has been up for days renders the
// same text on every tick, and comparing the text rather than the clock lets
// React skip those renders entirely instead of repainting the whole table once
// a second.
export function useElapsedLabel(startedAtMs: number, intervalMs = 1000): string {
  const subscribe = useCallback((listener: Listener) => subscribeUiClock(intervalMs, listener), [intervalMs]);
  const getSnapshot = useCallback(() => formatElapsed(Math.max(0, clockNow(intervalMs) - startedAtMs)), [startedAtMs, intervalMs]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
