// Whether the window is out of sight: minimised, or fully covered on a
// platform that reports it. A poller that asks the cluster for something
// nobody is looking at spends a kubectl process, a credential exchange and
// API server time on it, so the ticks that do are skipped meanwhile. The next
// tick after the window comes back refreshes as usual.
export function pageHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}
