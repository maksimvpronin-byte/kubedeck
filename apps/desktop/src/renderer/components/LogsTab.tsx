import { ChevronDown, ChevronUp, Copy, Download, Search } from "lucide-react";
import type { ReactNode, RefCallback } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useControlledAsyncActionFeedback } from "../hooks/useAsyncActionFeedback";
import { type AnsiLine, parseAnsiLines } from "../utils/ansi";
import { horizontalShift, verticalShift } from "../utils/revealMatch";
import { matchRanges, nextMatchIndex } from "../utils/searchMatches";
import { AsyncActionButton, refreshActionLabels } from "./AsyncActionButton";

// Where one occurrence sits: which of the lines on screen holds it, and the
// span inside that line.
interface LogMatch {
  line: number;
  from: number;
  to: number;
}

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
  // Deployment logs are read across its pods; the full download says so.
  deploymentLogs?: boolean;
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
  deploymentLogs = false,
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
  const [matchIndex, setMatchIndex] = useState(-1);
  const currentMarkRef = useRef<HTMLElement | null>(null);
  const refreshFeedback = useControlledAsyncActionFeedback(loading, refreshFailed);
  const normalizedQuery = query.trim().toLowerCase();
  // Programs that colour their output write terminal escapes into the log.
  // They are read for their colours and taken out of the text, so the filter,
  // the search and the visible download all work on what is on screen.
  const parsedLines = useMemo(() => parseAnsiLines(content ? content.split("\n") : []), [content]);
  const { lines, visibleLines, visibleText } = useMemo(() => {
    const filteredLines = normalizedQuery ? parsedLines.filter((line) => line.text.toLowerCase().includes(normalizedQuery)) : parsedLines;
    return { lines: parsedLines, visibleLines: filteredLines, visibleText: filteredLines.map((line) => line.text).join("\n") };
  }, [parsedLines, normalizedQuery]);

  // The query still filters the lines; these are the occurrences inside what
  // survived the filter, in reading order, so the arrows step through a log the
  // way they step through a manifest.
  const matches = useMemo<LogMatch[]>(
    () => visibleLines.flatMap((line, index) => matchRanges(line.text, normalizedQuery).map((range) => ({ line: index, from: range.from, to: range.to }))),
    [normalizedQuery, visibleLines],
  );
  const matchesByLine = useMemo(() => {
    const byLine = new Map<number, Array<LogMatch & { index: number }>>();
    matches.forEach((match, index) => {
      const bucket = byLine.get(match.line) ?? [];
      bucket.push({ ...match, index });
      byLine.set(match.line, bucket);
    });
    return byLine;
  }, [matches]);
  // Following logs keeps adding lines under the reader, so the step reached can
  // outlive the occurrence it counted; neither the counter nor the accent may
  // point past the end.
  const currentMatch = matchIndex < matches.length ? matchIndex : -1;

  function jumpMatch(direction: 1 | -1) {
    if (matches.length === 0) return;
    setMatchIndex(nextMatchIndex(currentMatch, direction, matches.length));
  }

  // Only the log pane is scrolled, by hand rather than through scrollIntoView,
  // which would also drag the drawer around the pane. Log lines are not
  // wrapped, so the column is as much a part of "where the match is" as the
  // row: a jump that moved rows alone left the occurrence off the right edge
  // and the pane looking like it had not moved at all.
  useEffect(() => {
    const output = outputRef.current;
    const mark = currentMarkRef.current;
    if (currentMatch < 0 || !output || !mark) return;
    const outputBox = output.getBoundingClientRect();
    const markBox = mark.getBoundingClientRect();
    output.scrollTop += verticalShift(markBox.top - outputBox.top, markBox.height, output.clientHeight);
    output.scrollLeft += horizontalShift(markBox.left - outputBox.left, markBox.width, output.clientWidth);
  }, [currentMatch]);

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
            {t("logs.pod")}
            <select value={selectedTargetPod} onChange={(event) => onTargetPodChange?.(event.target.value)}>
              <option value="">{t("logs.allPods")}</option>
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
            {t("logs.container")}
            <select value={selectedContainer} onChange={(event) => onContainerChange(event.target.value)}>
              {allowAllContainers ? <option value="">{t("logs.allContainers")}</option> : null}
              {containers.map((name) => (
                <option value={name} key={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          {t("logs.tail")}
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
          {t("logs.timestamps")}
        </label>
        <label className="logs-checkbox">
          <input type="checkbox" checked={previous} onChange={(event) => onPreviousChange(event.target.checked)} />
          {t("logs.previous")}
        </label>
        <label className="logs-checkbox">
          <input type="checkbox" checked={follow} onChange={(event) => onFollowChange(event.target.checked)} />
          {t("logs.follow")}
        </label>
        <span className="logs-action-tooltip" data-tooltip={t("logs.refresh")}>
          <AsyncActionButton
            className="icon-button logs-icon-action"
            phase={refreshFeedback.phase}
            labels={refreshActionLabels(t)}
            onClick={() => refreshFeedback.trigger(onRefresh)}
            disabled={loading}
          />
        </span>
        <span className="logs-action-tooltip" data-tooltip={t("logs.copy")}>
          <button className="icon-button logs-icon-action" onClick={onCopy} disabled={!content} aria-label={t("logs.copy")}>
            <Copy size={18} />
          </button>
        </span>
        <span className="logs-action-tooltip" data-tooltip={t("logs.download")}>
          <button className="icon-button logs-icon-action" onClick={() => setDownloadMenuOpen((current) => !current)} disabled={!content || downloadLoading} aria-label={t("logs.download")}>
            <Download size={18} />
          </button>
        </span>
      </div>
      {downloadMenuOpen ? (
        <section className="logs-download-choice" aria-label={t("logs.download")}>
          <div>
            <strong>{t("logs.download")}</strong>
            <p>{t(deploymentLogs ? "logs.downloadHintDeployment" : "logs.downloadHintPod")}</p>
          </div>
          <div className="logs-download-choice-actions">
            <button onClick={downloadVisibleAndClose} disabled={!visibleText || downloadLoading}>
              {t("logs.currentView")}
            </button>
            <button onClick={downloadFullAndClose} disabled={downloadLoading}>
              {downloadLoading ? t("logs.downloading") : t(deploymentLogs ? "logs.fullDeployment" : "logs.fullPod")}
            </button>
            <button onClick={() => setDownloadMenuOpen(false)} disabled={downloadLoading}>
              {t("common.cancel")}
            </button>
          </div>
        </section>
      ) : null}
      <div className="logs-search-row">
        <label className="logs-search">
          <Search size={14} />
          <input
            value={query}
            onChange={(event) => {
              onQueryChange(event.target.value);
              setMatchIndex(-1);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                jumpMatch(event.shiftKey ? -1 : 1);
              }
            }}
            placeholder={t("logs.search")}
          />
          <span>{loading ? t("common.refreshing") : normalizedQuery ? `${visibleLines.length}/${lines.length}` : `${lines.length} ${t("logs.lines")}`}</span>
        </label>
        <span className="match-counter">{normalizedQuery ? `${currentMatch >= 0 ? currentMatch + 1 : 0}/${matches.length}` : ""}</span>
        <span className="logs-action-tooltip" data-tooltip={`${t("logs.previousMatch")} (Shift+Enter)`}>
          <button className="icon-button logs-icon-action" disabled={matches.length === 0} onClick={() => jumpMatch(-1)} aria-label={t("logs.previousMatch")}>
            <ChevronUp size={18} />
          </button>
        </span>
        <span className="logs-action-tooltip" data-tooltip={`${t("logs.nextMatch")} (Enter)`}>
          <button className="icon-button logs-icon-action" disabled={matches.length === 0} onClick={() => jumpMatch(1)} aria-label={t("logs.nextMatch")}>
            <ChevronDown size={18} />
          </button>
        </span>
      </div>
      {follow ? <p className="terminal-muted">{t("logs.followHint")}</p> : null}
      <pre className="logs-output" ref={outputRef} onScroll={updateScrollStickiness}>
        {visibleLines.length === 0 ? (
          <span className="terminal-muted">{t("logs.empty")}</span>
        ) : (
          visibleLines.map((line, index) => (
            <span className="log-line" key={`${index}-${line.text.slice(0, 24)}`}>
              {renderLogLine(line, matchesByLine.get(index), currentMatch, (node) => {
                currentMarkRef.current = node;
              })}
              {index < visibleLines.length - 1 ? "\n" : ""}
            </span>
          ))
        )}
      </pre>
    </section>
  );
}

// Every occurrence in the line is marked, not just the first one, and the one
// the arrows are standing on is picked out of them. The marks are decoration
// only - the log pane is not editable, and nothing here is selected. A mark is
// one element even when it spans two colours, so the arrows land on the whole
// occurrence.
function renderLogLine(line: AnsiLine, lineMatches: Array<LogMatch & { index: number }> | undefined, current: number, currentRef: RefCallback<HTMLElement>): ReactNode {
  if (!lineMatches?.length) return renderColored(line, 0, line.text.length, "t");
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of lineMatches) {
    if (match.from > cursor) parts.push(renderColored(line, cursor, match.from, `t${cursor}`));
    const isCurrent = match.index === current;
    parts.push(
      <mark className={isCurrent ? "is-current" : undefined} key={match.index} ref={isCurrent ? currentRef : undefined}>
        {renderColored(line, match.from, match.to, `m${match.index}`)}
      </mark>,
    );
    cursor = match.to;
  }
  if (cursor < line.text.length) parts.push(renderColored(line, cursor, line.text.length, `t${cursor}`));
  return parts;
}

// The stretch [from, to) of a line, with the coloured parts of it in spans.
function renderColored(line: AnsiLine, from: number, to: number, keyPrefix: string): ReactNode {
  const runs = line.runs.filter((run) => run.to > from && run.from < to);
  if (!runs.length) return line.text.slice(from, to);
  const parts: ReactNode[] = [];
  let cursor = from;
  for (const run of runs) {
    const start = Math.max(run.from, from);
    const end = Math.min(run.to, to);
    if (start > cursor) parts.push(line.text.slice(cursor, start));
    parts.push(
      <span style={run.style} key={`${keyPrefix}-${start}`}>
        {line.text.slice(start, end)}
      </span>,
    );
    cursor = end;
  }
  if (cursor < to) parts.push(line.text.slice(cursor, to));
  return parts;
}
