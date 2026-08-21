import { ShieldAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ApiClient } from "../api";
import type { Cluster, ErrorInfo } from "../types";
import { asErrorInfo, isAbortError } from "../utils/errors";
import { ErrorPanel } from "./ErrorPanel";
import { YamlSourceEditor } from "./YamlSourceEditor";

interface Props {
  api: ApiClient | null;
  cluster: Cluster | null;
  t: (key: string) => string;
  onClose: () => void;
  onSaved: (cluster: Cluster) => void;
}

// The kubeconfig holds cluster credentials: it is fetched only while the modal
// is open, kept in component state, and never persisted to UI state.
export function KubeconfigEditorModal({ api, cluster, t, onClose, onSaved }: Props) {
  const [content, setContent] = useState("");
  const [loadedContent, setLoadedContent] = useState("");
  const [path, setPath] = useState("");
  const [editable, setEditable] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const changed = content !== loadedContent;

  useEffect(() => {
    if (!api || !cluster) return undefined;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api
      .clusterKubeconfig(cluster.id, controller.signal)
      .then((result) => {
        setContent(result.content);
        setLoadedContent(result.content);
        setPath(result.path);
        setEditable(result.editable);
      })
      .catch((err) => {
        if (isAbortError(err)) return;
        setError(asErrorInfo(err));
      })
      .finally(() => setLoading(false));
    return () => {
      controller.abort();
      setContent("");
      setLoadedContent("");
      setTypedName("");
      setPath("");
    };
  }, [api, cluster?.id]);

  if (!cluster) return null;

  function requestClose() {
    if (changed && !window.confirm(t("kubeconfig.discard"))) return;
    onClose();
  }

  async function save() {
    if (!api || !cluster || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await api.saveClusterKubeconfig(cluster.id, content, typedName.trim());
      setLoadedContent(content);
      setTypedName("");
      onSaved(result.cluster);
      onClose();
    } catch (err) {
      setError(asErrorInfo(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="kubeconfig-modal" role="dialog" aria-modal="true" aria-labelledby="kubeconfig-title">
        <header>
          <h2 id="kubeconfig-title">{`${t("kubeconfig.title")} — ${cluster.displayName}`}</h2>
          <button className="icon-button" onClick={requestClose} disabled={saving} title={t("common.close")} aria-label={t("common.close")}>
            <X size={16} />
          </button>
        </header>
        <div className="kubeconfig-body">
          <p className="kubeconfig-warning">
            <ShieldAlert size={15} aria-hidden="true" />
            <span>{t("kubeconfig.credentialsWarning")}</span>
          </p>
          <p className="muted small kubeconfig-path" title={path}>
            {path}
          </p>
          <ErrorPanel error={error} copyLabel={t("error.copy")} />
          {!editable && !loading ? <p className="kubeconfig-readonly">{t("kubeconfig.readOnly")}</p> : null}
          {loading ? (
            <div className="panel-loading" role="status">
              {t("common.loading")}
            </div>
          ) : (
            <YamlSourceEditor value={content} readOnly={!editable || saving} ariaLabel={t("kubeconfig.title")} onChange={setContent} />
          )}
        </div>
        <footer>
          <label className="kubeconfig-confirm">
            {t("kubeconfig.confirm")}
            <input value={typedName} placeholder={cluster.displayName} disabled={!editable || saving} onChange={(event) => setTypedName(event.target.value)} />
          </label>
          <div className="kubeconfig-actions">
            <button onClick={requestClose} disabled={saving}>
              {t("common.cancel")}
            </button>
            <button className="primary" onClick={() => void save()} disabled={!editable || saving || loading || !changed || typedName.trim() !== cluster.displayName}>
              {saving ? t("kubeconfig.saving") : t("kubeconfig.save")}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
