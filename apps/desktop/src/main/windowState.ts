import fs from "node:fs";
import path from "node:path";

// Where the window was, how big, and whether it was maximized - kept beside
// config.json so the next start opens where the last one closed instead of at
// 1440x920 in the middle of the primary screen.
const FILE_NAME = "window-state.json";

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  bounds: WindowBounds;
  maximized: boolean;
}

function isBounds(value: unknown): value is WindowBounds {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return ["x", "y", "width", "height"].every((key) => typeof candidate[key] === "number" && Number.isFinite(candidate[key]));
}

// A saved window is used only if enough of it lands on a screen that is still
// attached: a monitor unplugged since would otherwise open KubeDeck where
// nobody can see it. Too small a window is grown back to the minimum.
export function restorableWindowState(value: unknown, workAreas: WindowBounds[], minimum: { width: number; height: number }): WindowState | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (!isBounds(candidate.bounds)) return null;
  const bounds = {
    x: Math.round(candidate.bounds.x),
    y: Math.round(candidate.bounds.y),
    width: Math.max(minimum.width, Math.round(candidate.bounds.width)),
    height: Math.max(minimum.height, Math.round(candidate.bounds.height)),
  };
  const visible = workAreas.some((area) => {
    const overlapWidth = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
    const overlapHeight = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
    return overlapWidth >= 200 && overlapHeight >= 100;
  });
  return visible ? { bounds, maximized: candidate.maximized === true } : null;
}

export function readWindowState(appDataRoot: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(path.join(appDataRoot, FILE_NAME), "utf8"));
  } catch {
    return null;
  }
}

export function writeWindowState(appDataRoot: string, state: WindowState): void {
  try {
    fs.mkdirSync(appDataRoot, { recursive: true });
    fs.writeFileSync(path.join(appDataRoot, FILE_NAME), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  } catch {
    // Remembering the window is a convenience; a read-only profile must not
    // turn closing it into an error.
  }
}

// The one kind of link the renderer may hand to the system browser: a service
// KubeDeck forwarded to this machine. Parsed rather than prefix-matched, so
// "http://127.0.0.1:1@example.com" - whose host is example.com - is refused.
export function isForwardedServiceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && (url.hostname === "127.0.0.1" || url.hostname === "localhost") && !url.username && !url.password;
  } catch {
    return false;
  }
}
