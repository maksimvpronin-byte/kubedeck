import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function NamespaceSelector({
  namespaces,
  selected,
  disabled,
  allLabel,
  clusterScopedLabel,
  onChange,
}: {
  namespaces: string[];
  selected: string[];
  disabled: boolean;
  allLabel: string;
  clusterScopedLabel?: string;
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const normalized = normalizeNamespaceSelection(selected);
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
          <label>
            <input type="checkbox" checked={isAll} onChange={() => onChange(["all"])} />
            {allLabel}
          </label>
          {namespaces.map((namespace) => (
            <label key={namespace}>
              <input
                type="checkbox"
                checked={!isAll && normalized.includes(namespace)}
                onChange={() => toggleNamespace(namespace)}
              />
              {namespace}
            </label>
          ))}
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
