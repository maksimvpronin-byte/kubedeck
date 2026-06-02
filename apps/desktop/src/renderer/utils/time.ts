export function parseTimestamp(value: unknown): number {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const time = [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
  return days > 0 ? `${days}d ${time}` : time;
}

export function formatAge(value: unknown, now: number): string {
  const timestamp = parseTimestamp(value);
  if (!timestamp) return String(value ?? "unknown");
  return formatElapsed(now - timestamp);
}

export function formatAgeAgo(value: unknown, now: number): string {
  const timestamp = parseTimestamp(value);
  if (!timestamp) return String(value ?? "unknown");
  return `${formatElapsed(now - timestamp)} ago`;
}
