import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Cluster } from "../types";

interface ClusterSelectorProps {
  clusters: Cluster[];
  activeClusterId?: string;
  openingClusterId: string | null;
  emptyLabel: string;
  onChange: (cluster: Cluster) => void;
}

export function ClusterSelector({ clusters, activeClusterId, openingClusterId, emptyLabel, onChange }: ClusterSelectorProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const activeOptionRef = useRef<HTMLButtonElement | null>(null);
  const activeCluster = clusters.find((cluster) => cluster.id === activeClusterId);
  const disabled = clusters.length === 0 || Boolean(openingClusterId);

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => activeOptionRef.current?.focus());
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div className="cluster-selector" ref={rootRef}>
      <button type="button" className="cluster-selector-button" aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen((current) => !current)}>
        <span title={activeCluster?.displayName ?? emptyLabel}>{activeCluster?.displayName ?? emptyLabel}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && !disabled ? (
        <div className="cluster-menu" role="listbox" aria-label={emptyLabel}>
          <div className="cluster-menu-options">
            {clusters.map((cluster) => {
              const selected = cluster.id === activeClusterId;
              return (
                <button
                  type="button"
                  className={selected ? "cluster-menu-option is-selected" : "cluster-menu-option"}
                  role="option"
                  aria-selected={selected}
                  ref={selected ? activeOptionRef : undefined}
                  key={cluster.id}
                  title={cluster.displayName}
                  onClick={() => {
                    setOpen(false);
                    if (!selected) onChange(cluster);
                  }}
                >
                  <Check className={selected ? "cluster-menu-check is-visible" : "cluster-menu-check"} size={15} aria-hidden="true" />
                  <span>{cluster.displayName}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
