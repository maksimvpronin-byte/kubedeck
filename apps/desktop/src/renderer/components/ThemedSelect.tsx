import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

export interface ThemedSelectOption {
  value: string;
  label: string;
  description?: string;
  title?: string;
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
  const [opensUpward, setOpensUpward] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const selectedRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const bounds = rootRef.current?.getBoundingClientRect();
    if (bounds) setOpensUpward(window.innerHeight - bounds.bottom < 260 && bounds.top > window.innerHeight - bounds.bottom);
    window.requestAnimationFrame(() => selectedRef.current?.focus());
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
      if (event.key === "Tab") setOpen(false);
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

  function moveFocus(index: number) {
    const next = Math.max(0, Math.min(options.length - 1, index));
    optionRefs.current[next]?.focus();
  }

  function handleOptionKey(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      moveFocus(event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : index + (event.key === "ArrowDown" ? 1 : -1));
    }
  }

  return (
    <div className={`themed-select ${opensUpward ? "opens-upward" : ""}`} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="themed-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        title={selected?.title}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (!open && ["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="themed-select-value">
          <span>{selected?.label ?? ""}</span>
          {selected?.description ? <small>{selected.description}</small> : null}
        </span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && !disabled ? (
        <div className="themed-select-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((option, index) => {
            const isSelected = option.value === value;
            return (
              <button
                type="button"
                className={`themed-select-option ${isSelected ? "is-selected" : ""}`}
                role="option"
                aria-selected={isSelected}
                title={option.title}
                ref={(element) => {
                  optionRefs.current[index] = element;
                  if (isSelected) selectedRef.current = element;
                }}
                key={option.value}
                onKeyDown={(event) => handleOptionKey(event, index)}
                onClick={() => {
                  setOpen(false);
                  if (!isSelected) onChange(option.value);
                  window.requestAnimationFrame(() => triggerRef.current?.focus());
                }}
              >
                <Check size={14} className={isSelected ? "is-visible" : ""} aria-hidden="true" />
                <span className="themed-select-option-copy">
                  <span>{option.label}</span>
                  {option.description ? <small>{option.description}</small> : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
