import { Copy } from "lucide-react";
import { CommandPreviewBlock, sanitizeCommandPreview } from "./CommandPreviewBlock";
import type { ErrorInfo } from "../types";

interface Props {
  error: ErrorInfo | null;
  title?: string;
  copyLabel: string;
}

export function ErrorPanel({ error, title, copyLabel }: Props) {
  if (!error) return null;
  const text = [error.code, error.message, sanitizeCommandPreview(error.commandPreview), error.rawStderr].filter(Boolean).join("\n\n");
  return (
    <section className="error-panel">
      <div className="error-header">
        <div>
          <strong>{title ?? error.code}</strong>
          <p>{error.message}</p>
        </div>
        <button className="icon-text" onClick={() => navigator.clipboard.writeText(text)} title={copyLabel}>
          <Copy size={15} />
          {copyLabel}
        </button>
      </div>
      {error.commandPreview ? <CommandPreviewBlock command={error.commandPreview} /> : null}
      {error.rawStderr ? <pre>{error.rawStderr}</pre> : null}
      <ErrorHints error={error} />
    </section>
  );
}


function ErrorHints({ error }: { error: ErrorInfo }) {
  const hints = buildErrorHints(error);
  if (hints.length === 0) return null;
  return (
    <div className="error-hints">
      <strong>What to check</strong>
      <ul>
        {hints.map((hint) => <li key={hint}>{hint}</li>)}
      </ul>
    </div>
  );
}

function buildErrorHints(error: ErrorInfo): string[] {
  const code = error.code.toUpperCase();
  const text = `${error.message}
${error.rawStderr}`.toLowerCase();

  if (code.includes("TIMEOUT") || text.includes("timed out") || text.includes("timeout")) {
    return ["Check VPN/network access to the Kubernetes API server.", "Try the shown kubectl command in a terminal to compare behavior."];
  }

  if (code.includes("AUTH") || code.includes("FORBIDDEN") || text.includes("forbidden") || text.includes("cannot") && text.includes("resource")) {
    return ["RBAC probably denies this request for the current kubeconfig user.", "Check kubectl auth can-i for the resource, verb and namespace."];
  }

  if (code.includes("KUBECTL_NOT_FOUND") || text.includes("kubectl not found")) {
    return ["Check Settings -> kubectl path.", "Alternatively add kubectl.exe to PATH. The portable build does not bundle kubectl."];
  }

  if (code.includes("CLUSTER_UNAVAILABLE") || code.includes("CLUSTER_NOT_FOUND")) {
    return ["Check that the kubeconfig file still exists.", "Check that the cluster API server is reachable from this machine."];
  }

  if (code.includes("HTTP_ERROR") || text.includes("internal server error")) {
    return ["Open app logs from Settings and check the backend traceback.", "Retry the action once; if it repeats, the backend route likely needs a hotfix."];
  }

  if (text.includes("not found") || text.includes("notfound")) {
    return ["The resource may have been deleted, restarted or replaced.", "Refresh the table and open the newest resource instance."];
  }

  return [];
}
