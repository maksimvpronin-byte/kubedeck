import { ChevronDown, Search, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";

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
  // Every namespace touched while the menu is open stays in the block at the
  // top, checked or not. Unchecking one used to drop it straight back into the
  // alphabetical list, so re-checking it meant hunting for it again.
  const [pinned, setPinned] = useState<string[]>([]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const selectionRef = useRef(selected);
  selectionRef.current = selected;
  const normalized = normalizeNamespaceSelection(selected);
  const pinnedVisible = useMemo(() => pinnedNamespaces(namespaces, selected, pinned), [namespaces, selected, pinned]);
  const filteredNamespaces = useMemo(() => filterNamespaces(namespaces, selected, query, pinned), [namespaces, selected, query, pinned]);
  const isAll = normalized.includes("all");
  const isClusterScoped = normalized.includes("_cluster");
  const label = isClusterScoped ? (clusterScopedLabel ?? "Cluster-scoped") : isAll ? allLabel : normalized.length === 1 ? normalized[0] : `${normalized.length} namespaces`;

  useEffect(() => {
    if (!open) return;
    setQuery("");
    // Reopening the menu is the reset point: the block starts as whatever is
    // actually selected, so it never grows across sessions.
    setPinned(normalizeNamespaceSelection(selectionRef.current).filter((item) => item !== "all" && item !== "_cluster"));
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
    setPinned((currentPinned) => (currentPinned.includes(namespace) ? currentPinned : [...currentPinned, namespace]));
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
              <button
                type="button"
                aria-label={searchLabel}
                title={searchLabel}
                onClick={() => {
                  setQuery("");
                  searchRef.current?.focus();
                }}
              >
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
            {filteredNamespaces.length > 0 ? (
              filteredNamespaces.map((namespace, index) => (
                <Fragment key={namespace}>
                  {index === pinnedVisible.length && index > 0 ? <div className="namespace-menu-divider" /> : null}
                  <label title={namespace}>
                    <input type="checkbox" checked={!isAll && normalized.includes(namespace)} onChange={() => toggleNamespace(namespace)} />
                    <span className="namespace-menu-label">{namespace}</span>
                  </label>
                </Fragment>
              ))
            ) : (
              <div className="namespace-menu-empty">{emptySearchLabel}</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// The block held at the top of the menu: everything pinned during this session
// first, in the order it was touched, then anything selected that predates the
// pinning (a selection can change while the menu is open).
export function pinnedNamespaces(namespaces: string[], selected: string[], pinned: string[] = selected) {
  const selectedOrder = normalizeNamespaceSelection(selected).filter((item) => item !== "all" && item !== "_cluster");
  const pinnedOrder = pinned.filter((item) => item !== "all" && item !== "_cluster");
  const combined = [...pinnedOrder, ...selectedOrder.filter((item) => !pinnedOrder.includes(item))];
  return Array.from(new Set(combined)).filter((item) => namespaces.includes(item));
}

export function filterNamespaces(namespaces: string[], selected: string[], query: string, pinned: string[] = selected) {
  const needle = query.trim().toLowerCase();
  const top = pinnedNamespaces(namespaces, selected, pinned);
  const topSet = new Set(top);
  return [...top, ...namespaces.filter((namespace) => !topSet.has(namespace) && (!needle || namespace.toLowerCase().includes(needle)))];
}

function normalizeNamespaceSelection(value: string | string[]) {
  const raw = Array.isArray(value) ? value : value.split(",");
  const normalized = Array.from(new Set(raw.map((item) => item.trim()).filter(Boolean)));
  if (normalized.includes("_cluster")) return ["_cluster"];
  if (normalized.includes("all") || normalized.length === 0) return ["all"];
  return normalized;
}
