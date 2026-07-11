import { X } from "lucide-react";

interface Props {
  open: boolean;
  draft: string;
  renaming: boolean;
  t: (key: string) => string;
  onDraftChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function RenameClusterModal({ open, draft, renaming, t, onDraftChange, onCancel, onConfirm }: Props) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="rename-cluster-title">
        <header>
          <h2 id="rename-cluster-title">{t("clusters.renameTitle")}</h2>
          <button className="icon-button" onClick={onCancel} disabled={renaming} title={t("common.close")}>
            <X size={16} />
          </button>
        </header>
        <div className="confirm-body">
          <label className="confirm-field">
            {t("clusters.name")}
            <input
              autoFocus
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onConfirm();
                if (event.key === "Escape") onCancel();
              }}
            />
          </label>
        </div>
        <footer>
          <button onClick={onCancel} disabled={renaming}>
            {t("common.cancel")}
          </button>
          <button className="primary" onClick={onConfirm} disabled={renaming || !draft.trim()}>
            {renaming ? t("common.renaming") : t("common.rename")}
          </button>
        </footer>
      </section>
    </div>
  );
}
