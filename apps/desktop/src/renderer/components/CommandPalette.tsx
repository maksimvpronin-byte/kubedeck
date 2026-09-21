import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export type CommandPaletteItem = {
  id: string;
  title: string;
  subtitle: string;
  category: string;
  keywords: string;
  // Cluster search already matches labels, annotations and separate query tokens.
  searchMatched?: boolean;
  run: () => void | Promise<void>;
};

export function CommandPalette({
  query,
  items,
  loading,
  notice,
  placeholder,
  t,
  onQueryChange,
  onClose,
  onRun,
}: {
  query: string;
  items: CommandPaletteItem[];
  loading?: boolean;
  notice?: "partial" | "limited" | "failed" | null;
  placeholder: string;
  t: (key: string) => string;
  onQueryChange: (value: string) => void;
  onClose: () => void;
  onRun: (item: CommandPaletteItem) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    return normalizedQuery ? items.filter((item) => item.searchMatched || `${item.title} ${item.subtitle} ${item.category} ${item.keywords}`.toLowerCase().includes(normalizedQuery)) : items;
  }, [items, normalizedQuery]);
  const visibleItems = filtered.slice(0, 60);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, items]);

  function runActive() {
    const item = visibleItems[activeIndex];
    if (item) onRun(item);
  }

  return (
    <div className="command-palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(event) => event.stopPropagation()}>
        <div className="command-palette-input">
          <Search size={17} />
          <input
            ref={inputRef}
            value={query}
            placeholder={`${placeholder} ${t("command.placeholderSuffix")}`}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((current) => Math.min(current + 1, Math.max(visibleItems.length - 1, 0)));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((current) => Math.max(current - 1, 0));
              }
              if (event.key === "Enter") {
                event.preventDefault();
                runActive();
              }
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="command-palette-results">
          {loading ? (
            <div className="command-palette-empty" role="status">
              {t("command.searchingCluster")}
            </div>
          ) : null}
          {!loading && notice ? (
            <div className="command-palette-empty" role="status">
              {t(`command.search.${notice}`)}
            </div>
          ) : null}
          {!loading && filtered.length > visibleItems.length && notice !== "limited" ? (
            <div className="command-palette-empty" role="status">
              {t("command.search.limited")}
            </div>
          ) : null}
          {visibleItems.length ? (
            visibleItems.map((item, index) => (
              <button key={item.id} className={index === activeIndex ? "active" : ""} onMouseEnter={() => setActiveIndex(index)} onClick={() => onRun(item)}>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.subtitle}</small>
                </span>
                <em>{item.category}</em>
              </button>
            ))
          ) : !loading && !notice ? (
            <div className="command-palette-empty">{t("command.noMatches")}</div>
          ) : null}
        </div>
        <footer>
          <span>{t("command.openShortcut")}</span>
          <span>{t("command.clusterSearchHint")}</span>
        </footer>
      </section>
    </div>
  );
}
