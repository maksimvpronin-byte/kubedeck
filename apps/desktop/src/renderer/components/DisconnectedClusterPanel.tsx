import { PlugZap } from "lucide-react";

interface Props {
  visible: boolean;
  displayName: string;
  connecting: boolean;
  t: (key: string) => string;
  onConnect: () => void;
}

// A disconnected cluster used to keep showing whatever the table last loaded,
// with every action still on offer. The rows were stale by definition and the
// actions now fail at the gateway, so the workspace says what is going on and
// offers the one thing that helps.
export function DisconnectedClusterPanel({ visible, displayName, connecting, t, onConnect }: Props) {
  if (!visible) return null;
  return (
    <section className="unavailable-panel is-disconnected">
      <PlugZap size={28} aria-hidden="true" />
      <h2>{t("cluster.disconnected.title")}</h2>
      <p>{displayName}</p>
      <p className="unavailable-panel-hint">{t("cluster.disconnected.hint")}</p>
      <div className="row-actions">
        <button className="primary" disabled={connecting} onClick={onConnect}>
          {connecting ? t("clusters.opening") : t("clusters.connect")}
        </button>
      </div>
    </section>
  );
}
