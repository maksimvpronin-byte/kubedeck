import { X } from "lucide-react";
import type { BulkDeleteTarget, NodeActionConfirmation } from "../hooks/useBulkResourceActions";
import { bulkDeleteListText, bulkDeleteNamespaceSummary, nodeActionLabel, resourceIdentityLabel } from "../hooks/useBulkResourceActions";

interface Props {
  bulkDelete: BulkDeleteTarget | null;
  nodeAction: NodeActionConfirmation | null;
  t: (key: string) => string;
  onCloseBulkDelete: () => void;
  onCopyBulkDelete: () => void;
  onConfirmBulkDelete: () => void;
  onCloseNodeAction: () => void;
  onConfirmNodeAction: () => void;
}

export function BulkActionModals(props: Props) {
  const { bulkDelete, nodeAction, t } = props;
  return (
    <>
      {nodeAction ? (
        <div className="node-action-confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onCloseNodeAction(); }}>
          <div className="node-action-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="node-action-confirm-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="node-action-confirm-header">
              <div>
                <div className="node-action-confirm-kicker">Node action</div>
                <h2 id="node-action-confirm-title">Confirm {nodeActionLabel(nodeAction.action).toLowerCase()}</h2>
                <p>{nodeAction.rows.length} node(s) selected. Review the command preview before confirming.</p>
              </div>
              <button className="icon-button" type="button" aria-label="Close" onClick={props.onCloseNodeAction}><X size={16} /></button>
            </div>
            <div className="node-action-confirm-section">
              <div className="node-action-confirm-label">Affected nodes</div>
              <div className="node-action-confirm-node-list">
                {nodeAction.rows.map((row) => <code key={resourceIdentityLabel(row)}>{String(row.name)}</code>)}
              </div>
            </div>
            {nodeAction.action === "drain" ? (
              <div className="node-action-confirm-section">
                <div className="node-action-confirm-label">Affected pods preview</div>
                {nodeAction.previewLoading ? <p className="node-drain-preview-muted">Loading pods on selected nodes...</p>
                  : nodeAction.previewError ? <pre className="node-action-confirm-command node-drain-preview-error">{nodeAction.previewError}</pre>
                    : nodeAction.affectedPods?.length ? (
                      <div className="node-drain-pod-list">
                        {nodeAction.affectedPods.map((pod) => (
                          <div className="node-drain-pod-row" key={resourceIdentityLabel(pod)}>
                            <code>{String(pod.namespace ?? "_cluster")}/{String(pod.name)}</code>
                            <span>{String(pod.node ?? "")}</span>
                            <span>{String(pod.status ?? pod.phase ?? "")}</span>
                          </div>
                        ))}
                      </div>
                    ) : <p className="node-drain-preview-muted">No pods were found on the selected node(s).</p>}
              </div>
            ) : null}
            <div className="node-action-confirm-section">
              <div className="node-action-confirm-label">Command preview</div>
              <pre className="node-action-confirm-command">{nodeAction.commandPreview}</pre>
            </div>
            <div className="node-action-confirm-actions">
              <button className="secondary" type="button" onClick={props.onCloseNodeAction}>Cancel</button>
              <button className="primary" type="button" onClick={props.onConfirmNodeAction}>Confirm</button>
            </div>
          </div>
        </div>
      ) : null}
      {bulkDelete ? (
        <div className="modal-backdrop" role="presentation">
          <section className="confirm-modal bulk-delete-modal" role="dialog" aria-modal="true" aria-labelledby="bulk-delete-title">
            <header>
              <h2 id="bulk-delete-title">{t("bulkDelete.title")}</h2>
              <button className="icon-button" onClick={props.onCloseBulkDelete} title={t("common.close")}><X size={16} /></button>
            </header>
            <div className="confirm-body">
              <p>{t("bulkDelete.text")} <strong>{bulkDelete.rows.length}</strong>. {t("bulkDelete.warning")}</p>
              <div className="bulk-delete-meta" aria-label="Bulk delete scope">
                <span>{t("bulkDelete.resource")}: <strong>{bulkDelete.resource}</strong></span>
                <span>{t("bulkDelete.namespaces")}: <strong>{bulkDeleteNamespaceSummary(bulkDelete.rows)}</strong></span>
              </div>
              <div className="bulk-delete-list-header">
                <span>{t("bulkDelete.resources")}</span>
                <button type="button" onClick={props.onCopyBulkDelete}>{t("bulkDelete.copyList")}</button>
              </div>
              <pre className="bulk-delete-list">{bulkDeleteListText(bulkDelete.resource, bulkDelete.rows)}</pre>
            </div>
            <footer>
              <button onClick={props.onCloseBulkDelete}>{t("common.cancel")}</button>
              <button className="danger" onClick={props.onConfirmBulkDelete}>{t("common.delete")}</button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
