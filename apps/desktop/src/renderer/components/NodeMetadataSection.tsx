import { ChevronDown, ChevronRight, Copy, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { groupMetadataEntries, type MetadataEntry } from "../utils/metadataEntries";
import type { ResourceRow } from "../types";

interface Props {
  row: ResourceRow;
  onCopy?: (text: string, message: string) => void;
}

function labelEntries(row: ResourceRow): MetadataEntry[] {
  const labels = (row.labels ?? {}) as Record<string, unknown>;
  return Object.entries(labels)
    .map(([key, value]) => ({ key, value: String(value ?? "") }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function annotationEntries(row: ResourceRow): MetadataEntry[] {
  const items = (row.nodeAnnotationItems ?? []) as Array<{ key?: unknown; value?: unknown }>;
  return items.filter(Boolean).map((item) => ({ key: String(item.key ?? ""), value: String(item.value ?? "") }));
}

// Labels and annotations are what somebody decided about a node, and until now
// the only place to read them whole was the raw manifest. They are shown as
// they are - full keys, values in a monospace column - and grouped by the
// domain that owns the key, so what an operator set is not buried among the
// dozens Kubernetes and the CNI write for themselves.
export function NodeMetadataSection({ row, onCopy }: Props) {
  const labels = useMemo(() => labelEntries(row), [row]);
  const annotations = useMemo(() => annotationEntries(row), [row]);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();

  const matches = (entry: MetadataEntry) => !needle || `${entry.key}=${entry.value}`.toLowerCase().includes(needle);
  const shownLabels = labels.filter(matches);
  const shownAnnotations = annotations.filter(matches);

  if (labels.length === 0 && annotations.length === 0) return null;

  return (
    <section className="resource-summary-section node-metadata" aria-label="Labels and annotations">
      <div className="resource-summary-section-title">
        <span>Labels and annotations</span>
        <label className="node-metadata-search">
          <Search size={13} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter keys and values" aria-label="Filter labels and annotations" />
        </label>
      </div>
      <MetadataGroupList title="Labels" total={labels.length} entries={shownLabels} filtered={Boolean(needle)} onCopy={onCopy} />
      <MetadataGroupList title="Annotations" total={annotations.length} entries={shownAnnotations} filtered={Boolean(needle)} onCopy={onCopy} />
    </section>
  );
}

function MetadataGroupList({
  title,
  total,
  entries,
  filtered,
  onCopy,
}: {
  title: string;
  total: number;
  entries: MetadataEntry[];
  filtered: boolean;
  onCopy?: (text: string, message: string) => void;
}) {
  const groups = useMemo(() => groupMetadataEntries(entries), [entries]);
  if (total === 0) return null;

  return (
    <div className="node-metadata-block">
      <div className="node-metadata-block-head">
        <strong>{title}</strong>
        <span>{entries.length === total ? total : `${entries.length} of ${total}`}</span>
        {onCopy && entries.length ? (
          <button
            type="button"
            className="icon-button"
            title={`Copy ${title.toLowerCase()}`}
            aria-label={`Copy ${title.toLowerCase()}`}
            onClick={() => onCopy(entries.map((entry) => `${entry.key}=${entry.value}`).join("\n"), `${title} copied`)}
          >
            <Copy size={14} />
          </button>
        ) : null}
      </div>
      {entries.length === 0 ? (
        <p className="muted small">Nothing matches the filter.</p>
      ) : (
        groups.map((group) => <MetadataGroup key={group.prefix} prefix={group.prefix} wellKnown={group.wellKnown} entries={group.entries} startOpen={!group.wellKnown || filtered} />)
      )}
    </div>
  );
}

function MetadataGroup({ prefix, wellKnown, entries, startOpen }: { prefix: string; wellKnown: boolean; entries: MetadataEntry[]; startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <div className={`node-metadata-group ${wellKnown ? "is-well-known" : ""}`}>
      <button type="button" className="node-metadata-group-head" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span>{prefix || "no prefix"}</span>
        <small>{entries.length}</small>
      </button>
      {open ? (
        <dl className="node-metadata-rows">
          {entries.map((entry) => (
            <MetadataRow key={entry.key} entry={entry} />
          ))}
        </dl>
      ) : null}
    </div>
  );
}

const LONG_VALUE_LENGTH = 120;

function MetadataRow({ entry }: { entry: MetadataEntry }) {
  const [expanded, setExpanded] = useState(false);
  // A CNI or a cloud controller can write a whole JSON document into one
  // annotation, and one of those would push everything else off the screen.
  const long = entry.value.length > LONG_VALUE_LENGTH || entry.value.includes("\n");
  return (
    <div className={`node-metadata-row ${expanded ? "is-expanded" : ""}`}>
      <dt title={entry.key}>{entry.key}</dt>
      <dd>
        {long && !expanded ? <code>{`${entry.value.slice(0, LONG_VALUE_LENGTH)}…`}</code> : <code>{entry.value || <span className="muted">(empty)</span>}</code>}
        {long ? (
          <button type="button" className="link-button" onClick={() => setExpanded((current) => !current)}>
            {expanded ? "Less" : "More"}
          </button>
        ) : null}
      </dd>
    </div>
  );
}
