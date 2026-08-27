import type { Settings } from "../types";

export const REFRESH_INTERVAL_OPTIONS_SECONDS = [0, 10, 30, 60] as const;

export function normalizeRefreshIntervalSeconds(value: number | null | undefined): number {
  const numericValue = Number(value);
  if (REFRESH_INTERVAL_OPTIONS_SECONDS.some((option) => option === numericValue)) return numericValue;
  return 10;
}

export function getAutoRefreshIntervalSeconds(settings?: Pick<Settings, "refreshIntervalSeconds"> | null): number {
  return normalizeRefreshIntervalSeconds(settings?.refreshIntervalSeconds ?? 10);
}

export function shouldPollResources(intervalSeconds: number, watchHealthy: boolean): boolean {
  return intervalSeconds > 0 && !watchHealthy;
}

// A silent refresh exists to keep a panel current, which is exactly what the
// load already running is doing. Aborting that one to start another means a
// cluster slower than the interval never finishes a single walk - and for the
// Overview and Problems panels one walk is nine and five cluster-wide kubectl
// calls. The tick steps aside instead; the running load delivers.
export function shouldSkipSilentRefresh(silent: boolean, refreshRunning: boolean): boolean {
  return silent && refreshRunning;
}
