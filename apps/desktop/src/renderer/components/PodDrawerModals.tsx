import { X } from "lucide-react";
import { CommandPreviewBlock } from "./CommandPreviewBlock";
import type { ResourceRow } from "../types";

export type ResourceAction = "restart" | "redeploy" | "scale" | "delete" | "trigger";

interface ResourceActionConfirmModalProps {
  action: ResourceAction;
  resource: string;
  row: ResourceRow;
  replicas: number;
  onReplicasChange: (value: number) => void;
  // Fixed when the button was pressed, so the name in the preview is the name
  // the Job is created under.
  jobName: string;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  t: (key: string) => string;
}

export function ResourceActionConfirmModal({ action, resource, row, replicas, onReplicasChange, jobName, loading, onCancel, onConfirm, t }: ResourceActionConfirmModalProps) {
  const namespace = String(row.namespace || "_cluster");
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <header>
          <h2 id="confirm-title">{actionLabel(action, resource, t)}</h2>
          <button className="icon-button" onClick={onCancel} title={t("common.close")}>
            <X size={16} />
          </button>
        </header>
        <div className="confirm-body">
          <p>{actionDescription(action, resource, row.name, t)}</p>
          {action === "scale" ? (
            <label className="confirm-field">
              {t("drawer.modal.replicas")}
              <input type="number" min="0" value={replicas} onChange={(event) => onReplicasChange(Number(event.target.value))} />
            </label>
          ) : null}
          <code>
            {resource}/{row.name}
          </code>
          <p className="muted">{t("drawer.modal.reviewPreview")}</p>
          <CommandPreviewBlock command={commandPreview(action, resource, namespace, row.name, replicas, jobName)} />
        </div>
        <footer>
          <button onClick={onCancel} disabled={loading}>
            {t("common.cancel")}
          </button>
          <button className={action === "delete" ? "danger" : "primary"} onClick={onConfirm} disabled={loading}>
            {t("drawer.modal.confirm")}
          </button>
        </footer>
      </section>
    </div>
  );
}

interface YamlApplyConfirmModalProps {
  resource: string;
  row: ResourceRow;
  loading: boolean;
  onCancel: () => void;
  onApply: () => void;
  t: (key: string) => string;
}

export function YamlApplyConfirmModal({ resource, row, loading, onCancel, onApply, t }: YamlApplyConfirmModalProps) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="yaml-apply-confirm-title">
        <header>
          <h2 id="yaml-apply-confirm-title">{t("drawer.modal.applyYaml")}</h2>
          <button className="icon-button" onClick={onCancel} title={t("common.close")}>
            <X size={16} />
          </button>
        </header>
        <div className="confirm-body">
          <p>{t("drawer.modal.applyHint")}</p>
          <code>
            {resource}/{row.name}
          </code>
          <p className="muted">{t("drawer.modal.applyOneDocument")}</p>
          <CommandPreviewBlock command="kubectl apply -f -" />
        </div>
        <footer>
          <button onClick={onCancel} disabled={loading}>
            {t("common.cancel")}
          </button>
          <button className="danger" onClick={onApply} disabled={loading}>
            {t("drawer.modal.applyYaml")}
          </button>
        </footer>
      </section>
    </div>
  );
}

interface UnsavedYamlConfirmModalProps {
  resource: string;
  row: ResourceRow;
  onDiscard: () => void;
  onContinueEditing: () => void;
  t: (key: string) => string;
}

export function UnsavedYamlConfirmModal({ resource, row, onDiscard, onContinueEditing, t }: UnsavedYamlConfirmModalProps) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="yaml-close-confirm-title">
        <header>
          <h2 id="yaml-close-confirm-title">{t("drawer.modal.unsavedTitle")}</h2>
          <button className="icon-button" onClick={onContinueEditing} title={t("common.close")}>
            <X size={16} />
          </button>
        </header>
        <div className="confirm-body">
          <p>{t("drawer.modal.unsavedText")}</p>
          <code>
            {resource}/{row.name}
          </code>
        </div>
        <footer>
          <button className="danger" onClick={onDiscard}>
            {t("drawer.modal.discard")}
          </button>
          <button className="primary" onClick={onContinueEditing}>
            {t("drawer.modal.continueEditing")}
          </button>
        </footer>
      </section>
    </div>
  );
}

interface TerminalContainerPickerModalProps {
  row: ResourceRow;
  containers: string[];
  onCancel: () => void;
  onOpenContainer: (name: string) => void;
  t: (key: string) => string;
}

export function TerminalContainerPickerModal({ row, containers, onCancel, onOpenContainer, t }: TerminalContainerPickerModalProps) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="terminal-container-title">
        <header>
          <h2 id="terminal-container-title">{t("drawer.modal.selectContainer")}</h2>
          <button className="icon-button" onClick={onCancel} title={t("common.close")}>
            <X size={16} />
          </button>
        </header>
        <div className="confirm-body">
          <p>{t("drawer.modal.selectContainerText").replace("{name}", row.name)}</p>
          <div className="event-list">
            {containers.map((name) => (
              <button className="related-card" key={name} onClick={() => onOpenContainer(name)}>
                <strong>{name}</strong>
                <span>{t("logs.container")}</span>
              </button>
            ))}
          </div>
        </div>
        <footer>
          <button onClick={onCancel}>{t("common.cancel")}</button>
        </footer>
      </section>
    </div>
  );
}

export function supportedActions(resource: string): ResourceAction[] {
  if (resource === "pods") return ["restart", "delete"];
  if (["cronjobs", "cronjob"].includes(resource)) return ["trigger", "delete"];
  if (["deployments", "statefulsets"].includes(resource)) return ["redeploy", "scale", "delete"];
  if (resource === "daemonsets") return ["redeploy", "delete"];
  if (resource === "replicasets") return ["scale", "delete"];
  if (["jobs", "services", "configmaps", "secrets", "serviceaccounts"].includes(resource)) return ["delete"];
  return [];
}

const ACTION_LABELS: Record<string, [key: string, english: string]> = {
  trigger: ["drawer.action.trigger", "Run now"],
  restartPod: ["drawer.action.restartPod", "Restart pod"],
  restart: ["drawer.action.restart", "Restart"],
  redeploy: ["drawer.action.redeploy", "Redeploy"],
  scale: ["drawer.action.scale", "Scale"],
  delete: ["drawer.action.delete", "Delete"],
};

export function actionLabel(action: ResourceAction, resource: string, t?: (key: string) => string) {
  const [key, english] = ACTION_LABELS[action === "restart" && resource === "pods" ? "restartPod" : action] ?? ACTION_LABELS.delete;
  return t ? t(key) : english;
}

function actionDescription(action: ResourceAction, resource: string, name: string, t: (key: string) => string) {
  const key =
    action === "trigger"
      ? "trigger"
      : action === "restart" && resource === "pods"
        ? "restartPod"
        : action === "redeploy"
          ? "redeploy"
          : action === "scale"
            ? "scale"
            : action === "delete" && resource === "pods"
              ? "deletePod"
              : "delete";
  return t(`drawer.modal.describe.${key}`).replace("{name}", name);
}

function commandPreview(action: ResourceAction, resource: string, namespace: string, name: string, replicas: number, jobName: string) {
  const ns = namespace && namespace !== "_cluster" ? ` -n ${quoteKubectlArg(namespace)}` : "";
  const target = `${resource}/${name}`;
  if (action === "trigger") return `kubectl create job ${quoteKubectlArg(jobName)} --from=cronjob/${quoteKubectlArg(name)}${ns}`;
  if (action === "restart" && resource === "pods") return `kubectl delete pod ${quoteKubectlArg(name)} --wait=false${ns}`;
  if (action === "redeploy") return `kubectl rollout restart ${quoteKubectlArg(target)}${ns}`;
  if (action === "scale") return `kubectl scale ${quoteKubectlArg(target)} --replicas=${replicas}${ns}`;
  const force = action === "delete" && resource === "pods" ? " --force --grace-period=0" : "";
  return `kubectl delete ${quoteKubectlArg(resource)} ${quoteKubectlArg(name)}${force} --wait=false${ns}`;
}

function quoteKubectlArg(value: string) {
  if (!value) return '""';
  return /[\s"'&|<>]/.test(value) ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\"')}"` : value;
}
