interface Props {
  visible: boolean;
  displayName: string;
  opening: boolean;
  t: (key: string) => string;
  onRetry: () => void;
  onRemove: () => void;
}

export function UnavailableClusterPanel({ visible, displayName, opening, t, onRetry, onRemove }: Props) {
  if (!visible) return null;
  return (
    <section className="unavailable-panel">
      <h2>{t("cluster.unavailable")}</h2>
      <p>{displayName}</p>
      <div className="row-actions">
        <button className="primary" disabled={opening} onClick={onRetry}>
          {opening ? t("clusters.opening") : t("common.retry")}
        </button>
        <button onClick={onRemove}>{t("clusters.remove")}</button>
      </div>
    </section>
  );
}
