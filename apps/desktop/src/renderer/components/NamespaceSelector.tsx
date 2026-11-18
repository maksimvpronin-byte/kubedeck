import { ChevronDown, Search, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { namespaceExclusions } from "../../shared/namespaceScope";
import { normalizeNamespaceSelection } from "../utils/kubeResources";
import { recentNamespaceOrder } from "../utils/namespaceUsage";

export function NamespaceSelector({
  namespaces,
  selected,
  disabled,
  allLabel,
  clusterScopedLabel,
  selectedCountLabel = "{count} namespaces",
  excludedCountLabel = "All except {count}",
  excludeLabel = "Exclude",
  restoreLabel = "Restore",
  searchLabel,
  emptySearchLabel,
  recentUsage,
  onChange,
}: {
  namespaces: string[];
  selected: string[];
  disabled: boolean;
  allLabel: string;
  clusterScopedLabel?: string;
  /** Shown for more than one namespace; {count} is replaced. */
  selectedCountLabel?: string;
  excludedCountLabel?: string;
  excludeLabel?: string;
  restoreLabel?: string;
  searchLabel: string;
  emptySearchLabel: string;
  /** When each namespace was last part of the selection, for the active cluster. */
  recentUsage?: Record<string, number>;
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // The block held at the top of the menu: recently used namespaces, plus
  // anything touched during this session. Frozen while the menu is open so no
  // row ever moves under the cursor.
  const [pinned, setPinned] = useState<string[]>([]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const selectionRef = useRef(selected);
  const recentUsageRef = useRef(recentUsage);
  selectionRef.current = selected;
  recentUsageRef.current = recentUsage;
  const normalized = normalizeNamespaceSelection(selected);
  const excluded = new Set(namespaceExclusions(normalized));
  // Keep a saved exclusion removable even if the namespace has gone away.
  const menuNamespaces = useMemo(() => [...new Set([...namespaces, ...namespaceExclusions(selected)])], [namespaces, selected]);
  const pinnedVisible = useMemo(() => pinnedNamespaces(menuNamespaces, selected, pinned), [menuNamespaces, selected, pinned]);
  const filteredNamespaces = useMemo(() => filterNamespaces(menuNamespaces, selected, query, pinned), [menuNamespaces, selected, query, pinned]);
  const isAll = normalized.includes("all");
  const isExcluding = excluded.size > 0;
  const isClusterScoped = normalized.includes("_cluster");
  const label = isClusterScoped
    ? (clusterScopedLabel ?? "Cluster-scoped")
    : isAll
      ? allLabel
      : isExcluding
        ? excludedCountLabel.replace("{count}", String(excluded.size))
        : normalized.length === 1
          ? normalized[0]
          : selectedCountLabel.replace("{count}", String(normalized.length));

  useEffect(() => {
    if (!open) return;
    setQuery("");
    // Recomputed on every open, which is also where entries that aged out are
    // dropped: what has not been used for a while returns to alphabetical order.
    const selection = normalizeNamespaceSelection(selectionRef.current);
    const selectedNamespaced = namespaceExclusions(selection);
    if (!selectedNamespaced.length) selectedNamespaced.push(...explicitNamespaceNames(selection));
    setPinned(recentNamespaceOrder(recentUsageRef.current, selectedNamespaced, Date.now()));
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
    const current = explicitNamespaceNames(normalized);
    const next = current.includes(namespace) ? current.filter((item) => item !== namespace) : [...current, namespace];
    setPinned((currentPinned) => (currentPinned.includes(namespace) ? currentPinned : [...currentPinned, namespace]));
    onChange(next.length ? next : ["all"]);
  }

  function toggleExclusion(namespace: string) {
    if (excluded.has(namespace)) excluded.delete(namespace);
    else excluded.add(namespace);
    onChange(excluded.size ? [...excluded].map((item) => "!" + item) : ["all"]);
  }

  return (
    <div className="namespace-selector" ref={rootRef}>
      <button type="button" className="namespace-selector-button" disabled={disabled} aria-expanded={open && !disabled} onClick={() => setOpen((current) => !current)}>
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
            <input
              type="checkbox"
              checked={isAll}
              ref={(input) => {
                if (input) input.indeterminate = isExcluding;
              }}
              onChange={() => onChange(["all"])}
            />
            <span className="namespace-menu-label" title={allLabel}>
              {allLabel}
            </span>
          </label>
          <div className="namespace-menu-options">
            {filteredNamespaces.length > 0 ? (
              filteredNamespaces.map((namespace, index) => {
                const isExcluded = excluded.has(namespace);
                const actionLabel = isExcluded ? restoreLabel : excludeLabel;
                return (
                  <Fragment key={namespace}>
                    {index === pinnedVisible.length && index > 0 ? <div className="namespace-menu-divider" /> : null}
                    <div className={isExcluded ? "namespace-menu-row is-excluded" : "namespace-menu-row"}>
                      <label title={namespace}>
                        <input type="checkbox" checked={!isAll && normalized.includes(namespace)} onChange={() => toggleNamespace(namespace)} />
                        <span className="namespace-menu-label">{namespace}</span>
                      </label>
                      {isAll || isExcluding ? (
                        <button type="button" className="namespace-menu-exclusion" aria-label={actionLabel + " " + namespace} onClick={() => toggleExclusion(namespace)}>
                          {actionLabel}
                        </button>
                      ) : null}
                    </div>
                  </Fragment>
                );
              })
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
  const selectedOrder = explicitNamespaceNames(normalizeNamespaceSelection(selected));
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

function explicitNamespaceNames(selection: string[]) {
  return selection.filter((item) => item !== "all" && item !== "_cluster" && !item.startsWith("!"));
}
