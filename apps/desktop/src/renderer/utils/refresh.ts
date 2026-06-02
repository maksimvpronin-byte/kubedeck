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
