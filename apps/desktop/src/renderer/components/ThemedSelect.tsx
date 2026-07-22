import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface ThemedSelectOption {
  value: string;
  label: string;
}

export function ThemedSelect({
  value,
  options,
  disabled = false,
  ariaLabel,
  onChange,
}: {
  value: string;
  options: ThemedSelectOption[];
  disabled?: boolean;
  ariaLabel: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedRef = useRef<HTMLButtonElement | null>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => selectedRef.current?.focus());
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeEscape);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div className="themed-select" ref={rootRef}>
      <button type="button" className="themed-select-trigger" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen((current) => !current)}>
        <span>{selected?.label ?? ""}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && !disabled ? (
        <div className="themed-select-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                type="button"
                className={`themed-select-option ${isSelected ? "is-selected" : ""}`}
                role="option"
                aria-selected={isSelected}
                ref={isSelected ? selectedRef : undefined}
                key={option.value}
                onClick={() => {
                  setOpen(false);
                  if (!isSelected) onChange(option.value);
                }}
              >
                <Check size={14} className={isSelected ? "is-visible" : ""} aria-hidden="true" />
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
