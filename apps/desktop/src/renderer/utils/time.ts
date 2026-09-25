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
  // Years the way kubectl writes them, from the first year rather than the
  // second: 400d reads as 1y35d.
  const years = Math.floor(days / 365);
  if (years > 0) return days % 365 ? `${years}y${days % 365}d` : `${years}y`;
  if (days > 0) return `${days}d`;
  const time = [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
  return time;
}

export function formatAge(value: unknown, now: number): string {
  const timestamp = parseTimestamp(value);
  if (!timestamp) return String(value ?? "unknown");
  return formatElapsed(now - timestamp);
}
