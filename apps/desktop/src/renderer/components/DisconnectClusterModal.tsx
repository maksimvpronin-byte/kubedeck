import { X } from "lucide-react";
import type { Cluster, ClusterLiveSessions } from "../types";

interface Props {
  target: { cluster: Cluster; sessions: ClusterLiveSessions } | null;
  disconnecting: boolean;
  t: (key: string) => string;
  onCancel: () => void;
  onConfirm: () => void;
}

// Background polling can be stopped without asking, but a port-forward is a
// socket some other application is using right now, and a pod terminal or node
// SSH session is someone's shell. This dialog only appears when at least one of
// those is open, and it names them rather than warning in the abstract.
export function DisconnectClusterModal({ target, disconnecting, t, onCancel, onConfirm }: Props) {
  if (!target) return null;
  const { cluster, sessions } = target;
  // Watches are listed for completeness but never on their own: this dialog
  // only opens when a port forward, terminal or SSH session is actually held.
  const rows: Array<[string, number]> = [
    [t("clusters.disconnect.portForwards"), sessions.portForwards],
    [t("clusters.disconnect.terminals"), sessions.terminals],
    [t("clusters.disconnect.sshSessions"), sessions.sshSessions],
    [t("clusters.disconnect.watches"), sessions.watches],
  ];

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="disconnect-cluster-title">
        <header>
          <h2 id="disconnect-cluster-title">{t("clusters.disconnect.title")}</h2>
          <button className="icon-button" onClick={onCancel} disabled={disconnecting} title={t("common.close")}>
            <X size={16} />
          </button>
        </header>
        <div className="confirm-body">
          <p>{t("clusters.disconnect.body").replace("{cluster}", cluster.displayName)}</p>
          <ul className="disconnect-session-list">
            {rows
              .filter(([, count]) => count > 0)
              .map(([label, count]) => (
                <li key={label}>
                  <span>{label}</span>
                  <strong>{count}</strong>
                </li>
              ))}
          </ul>
        </div>
        <footer>
          <button onClick={onCancel} disabled={disconnecting}>
            {t("common.cancel")}
          </button>
          <button className="danger" onClick={onConfirm} disabled={disconnecting}>
            {disconnecting ? t("clusters.disconnect.working") : t("clusters.disconnect.confirm")}
          </button>
        </footer>
      </section>
    </div>
  );
}
