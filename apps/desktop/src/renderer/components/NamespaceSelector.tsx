import { ChevronDown, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export function NamespaceSelector({
  namespaces,
  selected,
  disabled,
  allLabel,
  clusterScopedLabel,
  searchLabel,
  emptySearchLabel,
  onChange,
}: {
  namespaces: string[];
  selected: string[];
  disabled: boolean;
  allLabel: string;
  clusterScopedLabel?: string;
  searchLabel: string;
  emptySearchLabel: string;
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const normalized = normalizeNamespaceSelection(selected);
  const filteredNamespaces = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return namespaces;
    return namespaces.filter((namespace) => namespace.toLowerCase().includes(needle));
  }, [namespaces, query]);
  const isAll = normalized.includes("all");
  const isClusterScoped = normalized.includes("_cluster");
  const label = isClusterScoped
    ? (clusterScopedLabel ?? "Cluster-scoped")
    : isAll
      ? allLabel
      : normalized.length === 1
        ? normalized[0]
        : `${normalized.length} namespaces`;

  useEffect(() => {
    if (!open) return;
    setQuery("");
    window.requestAnimationFrame(() => searchRef.current?.focus());
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutsideClick);
    return () => window.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [open]);

  function toggleNamespace(namespace: string) {
    if (namespace === "all") {
      onChange(["all"]);
      return;
    }
    const current = normalized.filter((item) => item !== "all" && item !== "_cluster");
    const next = current.includes(namespace) ? current.filter((item) => item !== namespace) : [...current, namespace];
    onChange(next.length ? next : ["all"]);
  }

  return (
    <div className="namespace-selector" ref={rootRef}>
      <button className="namespace-selector-button" disabled={disabled} onClick={() => setOpen((current) => !current)}>
        <span>{label}</span>
        <ChevronDown size={14} />
      </button>
      {open && !disabled ? (
        <div className="namespace-menu">
          <div className="namespace-menu-search">
            <Search size={14} />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.stopPropagation();
                if (query) setQuery("");
                else setOpen(false);
              }}
              placeholder={searchLabel}
            />
            {query ? (
              <button type="button" aria-label={searchLabel} title={searchLabel} onClick={() => {
                setQuery("");
                searchRef.current?.focus();
              }}>
                <X size={14} />
              </button>
            ) : null}
          </div>
          <label>
            <input type="checkbox" checked={isAll} onChange={() => onChange(["all"])} />
            <span className="namespace-menu-label" title={allLabel}>
              {allLabel}
            </span>
          </label>
          <div className="namespace-menu-options">
            {filteredNamespaces.length > 0 ? filteredNamespaces.map((namespace) => (
              <label key={namespace} title={namespace}>
                <input
                  type="checkbox"
                  checked={!isAll && normalized.includes(namespace)}
                  onChange={() => toggleNamespace(namespace)}
                />
                <span className="namespace-menu-label">{namespace}</span>
              </label>
            )) : (
              <div className="namespace-menu-empty">{emptySearchLabel}</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function normalizeNamespaceSelection(value: string | string[]) {
  const raw = Array.isArray(value) ? value : value.split(",");
  const normalized = Array.from(new Set(raw.map((item) => item.trim()).filter(Boolean)));
  if (normalized.includes("_cluster")) return ["_cluster"];
  if (normalized.includes("all") || normalized.length === 0) return ["all"];
  return normalized;
}
