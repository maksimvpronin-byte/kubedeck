import { Copy, Download, Search } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useControlledAsyncActionFeedback } from "../hooks/useAsyncActionFeedback";
import { AsyncActionButton, refreshActionLabels } from "./AsyncActionButton";

interface LogsTabProps {
  content: string;
  loading: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  tail: number;
  onTailChange: (value: number) => void;
  previous: boolean;
  onPreviousChange: (value: boolean) => void;
  timestamps: boolean;
  onTimestampsChange: (value: boolean) => void;
  follow: boolean;
  onFollowChange: (value: boolean) => void;
  containers: string[];
  selectedContainer: string;
  onContainerChange: (value: string) => void;
  allowAllContainers?: boolean;
  targetPods?: string[];
  selectedTargetPod?: string;
  onTargetPodChange?: (value: string) => void;
  contextLabel?: string;
  fullDownloadLabel?: string;
  onRefresh: () => void;
  refreshFailed: boolean;
  t: (key: string) => string;
  onCopy: () => void;
  downloadLoading: boolean;
  onDownloadVisible: (visibleText: string) => void;
  onDownloadFull: () => Promise<void> | void;
}

export function LogsTab({
  content,
  loading,
  query,
  onQueryChange,
  tail,
  onTailChange,
  previous,
  onPreviousChange,
  timestamps,
  onTimestampsChange,
  follow,
  onFollowChange,
  containers,
  selectedContainer,
  onContainerChange,
  allowAllContainers = false,
  targetPods = [],
  selectedTargetPod = "",
  onTargetPodChange,
  contextLabel = "pod",
  fullDownloadLabel = "Full pod log",
  onRefresh,
  refreshFailed,
  t,
  onCopy,
  downloadLoading,
  onDownloadVisible,
  onDownloadFull,
}: LogsTabProps) {
  const outputRef = useRef<HTMLPreElement | null>(null);
  const stickToBottomRef = useRef(true);
  const previousContentRef = useRef(content);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const refreshFeedback = useControlledAsyncActionFeedback(loading, refreshFailed);
  const lines = content ? content.split("\n") : [];
  const normalizedQuery = query.trim().toLowerCase();
  const visibleLines = normalizedQuery ? lines.filter((line) => line.toLowerCase().includes(normalizedQuery)) : lines;
  const visibleText = visibleLines.join("\n");

  useLayoutEffect(() => {
    const output = outputRef.current;
    if (!output) return;

    const contentChanged = previousContentRef.current !== content;
    previousContentRef.current = content;

    if (!contentChanged) return;
    if (follow || stickToBottomRef.current) {
      output.scrollTop = output.scrollHeight;
    }
  }, [content, follow]);

  function updateScrollStickiness() {
    const output = outputRef.current;
    if (!output) return;
    const distanceFromBottom = output.scrollHeight - output.scrollTop - output.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 48;
  }

  async function downloadFullAndClose() {
    await onDownloadFull();
    setDownloadMenuOpen(false);
  }

  function downloadVisibleAndClose() {
    onDownloadVisible(visibleText);
    setDownloadMenuOpen(false);
  }

  return (
    <section className="logs-viewer">
      <div className="logs-toolbar">
        {targetPods.length > 1 ? (
          <label>
            Pod
            <select value={selectedTargetPod} onChange={(event) => onTargetPodChange?.(event.target.value)}>
              <option value="">All pods</option>
              {targetPods.map((name) => (
                <option value={name} key={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {containers.length > 1 || allowAllContainers ? (
          <label>
            Container
            <select value={selectedContainer} onChange={(event) => onContainerChange(event.target.value)}>
              {allowAllContainers ? <option value="">All containers</option> : null}
              {containers.map((name) => (
                <option value={name} key={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          Tail
          <select value={tail} onChange={(event) => onTailChange(Number(event.target.value))}>
            {[100, 300, 500, 1000, 2000, 5000].map((value) => (
              <option value={value} key={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="logs-checkbox">
          <input type="checkbox" checked={timestamps} onChange={(event) => onTimestampsChange(event.target.checked)} />
          Timestamps
        </label>
        <label className="logs-checkbox">
          <input type="checkbox" checked={previous} onChange={(event) => onPreviousChange(event.target.checked)} />
          Previous
        </label>
        <label className="logs-checkbox">
          <input type="checkbox" checked={follow} onChange={(event) => onFollowChange(event.target.checked)} />
          Follow
        </label>
        <span className="logs-action-tooltip" data-tooltip="Refresh logs">
          <AsyncActionButton
            className="icon-button logs-icon-action"
            phase={refreshFeedback.phase}
            labels={refreshActionLabels(t)}
            onClick={() => refreshFeedback.trigger(onRefresh)}
            disabled={loading}
          />
        </span>
        <span className="logs-action-tooltip" data-tooltip="Copy logs">
          <button className="icon-button logs-icon-action" onClick={onCopy} disabled={!content} aria-label="Copy logs">
            <Copy size={18} />
          </button>
        </span>
        <span className="logs-action-tooltip" data-tooltip="Download logs">
          <button className="icon-button logs-icon-action" onClick={() => setDownloadMenuOpen((current) => !current)} disabled={!content || downloadLoading} aria-label="Download logs">
            <Download size={18} />
          </button>
        </span>
      </div>
      {downloadMenuOpen ? (
        <section className="logs-download-choice" aria-label="Download logs">
          <div>
            <strong>Download logs</strong>
            <p>Choose whether to save the current loaded view or request the full {contextLabel} log from Kubernetes.</p>
          </div>
          <div className="logs-download-choice-actions">
            <button onClick={downloadVisibleAndClose} disabled={!visibleText || downloadLoading}>
              Current view
            </button>
            <button onClick={downloadFullAndClose} disabled={downloadLoading}>
              {downloadLoading ? "Downloading..." : fullDownloadLabel}
            </button>
            <button onClick={() => setDownloadMenuOpen(false)} disabled={downloadLoading}>
              Cancel
            </button>
          </div>
        </section>
      ) : null}
      <label className="logs-search">
        <Search size={14} />
        <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search logs" />
        <span>{loading ? "Refreshing..." : normalizedQuery ? `${visibleLines.length}/${lines.length}` : `${lines.length} lines`}</span>
      </label>
      {follow ? <p className="terminal-muted">Follow mode refreshes bounded logs every 3 seconds.</p> : null}
      <pre className="logs-output" ref={outputRef} onScroll={updateScrollStickiness}>
        {visibleLines.length === 0 ? (
          <span className="terminal-muted">No log lines.</span>
        ) : (
          visibleLines.map((line, index) => (
            <span className="log-line" key={`${index}-${line.slice(0, 24)}`}>
              {highlightLogLine(line, query)}
              {index < visibleLines.length - 1 ? "\n" : ""}
            </span>
          ))
        )}
      </pre>
    </section>
  );
}

function highlightLogLine(line: string, query: string): ReactNode {
  if (!query.trim()) return line;
  const lower = line.toLowerCase();
  const needle = query.trim().toLowerCase();
  const start = lower.indexOf(needle);
  if (start < 0) return line;
  const end = start + query.trim().length;
  return (
    <>
      {line.slice(0, start)}
      <mark>{line.slice(start, end)}</mark>
      {line.slice(end)}
    </>
  );
}
