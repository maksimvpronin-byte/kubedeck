import { X } from "lucide-react";
import { CommandPreviewBlock } from "./CommandPreviewBlock";
import type { ResourceRow } from "../types";

export type ResourceAction = "restart" | "redeploy" | "scale" | "delete";

interface ResourceActionConfirmModalProps {
  action: ResourceAction;
  resource: string;
  row: ResourceRow;
  replicas: number;
  onReplicasChange: (value: number) => void;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ResourceActionConfirmModal({
  action,
  resource,
  row,
  replicas,
  onReplicasChange,
  loading,
  onCancel,
  onConfirm,
}: ResourceActionConfirmModalProps) {
  const namespace = String(row.namespace || "_cluster");
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <header>
          <h2 id="confirm-title">{actionLabel(action, resource)}</h2>
          <button className="icon-button" onClick={onCancel} title="Close">
            <X size={16} />
          </button>
        </header>
        <div className="confirm-body">
          <p>{actionDescription(action, resource, row.name)}</p>
          {action === "scale" ? (
            <label className="confirm-field">
              Replicas
              <input type="number" min="0" value={replicas} onChange={(event) => onReplicasChange(Number(event.target.value))} />
            </label>
          ) : null}
          <code>{resource}/{row.name}</code>
          <p className="muted">Review the exact kubectl action preview and confirm the action. Typing the resource name is not required.</p>
          <CommandPreviewBlock command={commandPreview(action, resource, namespace, row.name, replicas)} />
        </div>
        <footer>
          <button onClick={onCancel} disabled={loading}>Cancel</button>
          <button className={action === "delete" ? "danger" : "primary"} onClick={onConfirm} disabled={loading}>
            Confirm
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
}

export function YamlApplyConfirmModal({ resource, row, loading, onCancel, onApply }: YamlApplyConfirmModalProps) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="yaml-apply-confirm-title">
        <header>
          <h2 id="yaml-apply-confirm-title">Apply YAML</h2>
          <button className="icon-button" onClick={onCancel} title="Close">
            <X size={16} />
          </button>
        </header>
        <div className="confirm-body">
          <p>Server dry-run is recommended before applying YAML. Review the target resource and confirm the apply operation.</p>
          <code>{resource}/{row.name}</code>
          <p className="muted">KubeDeck applies one YAML document at a time. Typing the resource name is not required.</p>
          <CommandPreviewBlock command="kubectl apply -f -" />
        </div>
        <footer>
          <button onClick={onCancel} disabled={loading}>Cancel</button>
          <button className="danger" onClick={onApply} disabled={loading}>
            Apply YAML
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
}

export function UnsavedYamlConfirmModal({ resource, row, onDiscard, onContinueEditing }: UnsavedYamlConfirmModalProps) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="yaml-close-confirm-title">
        <header>
          <h2 id="yaml-close-confirm-title">Unsaved YAML changes</h2>
          <button className="icon-button" onClick={onContinueEditing} title="Close">
            <X size={16} />
          </button>
        </header>
        <div className="confirm-body">
          <p>You have unsaved YAML changes for this resource. Close the drawer and discard them, or continue editing?</p>
          <code>{resource}/{row.name}</code>
        </div>
        <footer>
          <button className="danger" onClick={onDiscard}>Discard changes</button>
          <button className="primary" onClick={onContinueEditing}>Continue editing</button>
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
}

export function TerminalContainerPickerModal({ row, containers, onCancel, onOpenContainer }: TerminalContainerPickerModalProps) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="terminal-container-title">
        <header>
          <h2 id="terminal-container-title">Select container</h2>
          <button className="icon-button" onClick={onCancel} title="Close">
            <X size={16} />
          </button>
        </header>
        <div className="confirm-body">
          <p>{row.name} has multiple containers. Choose where to open the terminal.</p>
          <div className="event-list">
            {containers.map((name) => (
              <button className="related-card" key={name} onClick={() => onOpenContainer(name)}>
                <strong>{name}</strong>
                <span>container</span>
              </button>
            ))}
          </div>
        </div>
        <footer>
          <button onClick={onCancel}>Cancel</button>
        </footer>
      </section>
    </div>
  );
}

export function supportedActions(resource: string): ResourceAction[] {
  if (resource === "pods") return ["restart", "delete"];
  if (["deployments", "statefulsets"].includes(resource)) return ["redeploy", "scale", "delete"];
  if (resource === "daemonsets") return ["redeploy", "delete"];
  if (resource === "replicasets") return ["scale", "delete"];
  if (["jobs", "cronjobs", "replicasets", "services", "configmaps", "secrets", "serviceaccounts"].includes(resource)) return ["delete"];
  return [];
}

export function actionLabel(action: ResourceAction, resource: string) {
  if (action === "restart") return resource === "pods" ? "Restart pod" : "Restart";
  if (action === "redeploy") return "Redeploy";
  if (action === "scale") return "Scale";
  return "Delete";
}

function actionDescription(action: ResourceAction, resource: string, name: string) {
  if (action === "restart" && resource === "pods") return `Restart ${name} by deleting the pod and letting its controller recreate it.`;
  if (action === "redeploy") return `Trigger a rollout restart for ${name}.`;
  if (action === "scale") return `Set desired replicas for ${name}.`;
  if (action === "delete" && resource === "pods") return `Force delete ${name} immediately without graceful shutdown. A controller may recreate it; a standalone pod will not be restored.`;
  return `Delete ${name}. This action cannot be undone from KubeDeck.`;
}

function commandPreview(action: ResourceAction, resource: string, namespace: string, name: string, replicas: number) {
  const ns = namespace && namespace !== "_cluster" ? ` -n ${quoteKubectlArg(namespace)}` : "";
  const target = `${resource}/${name}`;
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
