import { X } from "lucide-react";
import { useEffect, useRef } from "react";

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
}

interface Props {
  request: ConfirmRequest | null;
  t: (key: string) => string;
  onClose: () => void;
}

// In place of window.confirm. A native dialog on Windows can hand the keyboard
// back to nothing when it closes: the caret blinks in a field and no key
// reaches it until the window is reloaded. This one is part of the page, so
// focus never leaves it, and it is put back where it was when the dialog goes.
export function ConfirmDialog({ request, t, onClose }: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const open = Boolean(request);
  const danger = Boolean(request?.danger);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    returnFocusRef.current = previous instanceof HTMLElement ? previous : null;
    // A destructive answer is not the one Enter gives by accident.
    (danger ? cancelRef : confirmRef).current?.focus();
    return () => {
      const target = returnFocusRef.current;
      returnFocusRef.current = null;
      // Whatever the confirmed action focused on its own is left alone.
      if (target?.isConnected && (document.activeElement === document.body || document.activeElement === null)) target.focus();
    };
  }, [open, danger]);

  if (!request) return null;

  // Closed before the action runs, so an action that asks a second question
  // opens a dialog of its own rather than having it closed underneath it.
  const confirm = () => {
    onClose();
    request.onConfirm();
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
      >
        <header>
          <h2 id="confirm-dialog-title">{request.title}</h2>
          <button className="icon-button" onClick={onClose} title={t("common.close")} aria-label={t("common.close")}>
            <X size={16} />
          </button>
        </header>
        <div className="confirm-body">
          <p id="confirm-dialog-message">{request.message}</p>
        </div>
        <footer>
          <button ref={cancelRef} onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button ref={confirmRef} className={request.danger ? "danger" : "primary"} onClick={confirm}>
            {request.confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}
