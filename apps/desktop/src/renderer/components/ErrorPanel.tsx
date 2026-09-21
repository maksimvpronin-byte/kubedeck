import { Copy } from "lucide-react";
import { CommandPreviewBlock, sanitizeCommandPreview } from "./CommandPreviewBlock";
import type { ErrorInfo } from "../types";

interface Props {
  error: ErrorInfo | null;
  title?: string;
  copyLabel: string;
  // Without a translator the panel speaks English, as it did before.
  t?: (key: string) => string;
}

type ErrorKind = "timeout" | "forbidden" | "kubectl" | "cluster" | "backend" | "notFound" | "generic";

const ENGLISH: Record<string, string> = {
  "error.whatToCheck": "What to check",
  "error.details": "Technical details",
  "error.kind.timeout": "The cluster did not answer in time",
  "error.kind.forbidden": "Access denied",
  "error.kind.kubectl": "kubectl not found",
  "error.kind.cluster": "Cluster unavailable",
  "error.kind.backend": "KubeDeck could not complete the request",
  "error.kind.notFound": "Resource not found",
  "error.kind.generic": "The request failed",
  "error.forbiddenScope": "No permission to {verb} {resource} in namespace {namespace}.",
  "error.forbiddenScopeCluster": "No permission to {verb} {resource} at cluster level.",
  "error.hint.timeout.1": "Check VPN or network access to the Kubernetes API server.",
  "error.hint.timeout.2": "Narrow the namespace selection and try again.",
  "error.hint.forbidden.1": "Pick a namespace you have access to, or ask the cluster administrator for this permission.",
  "error.hint.forbidden.2": "kubectl auth can-i shows what the current kubeconfig user may do.",
  "error.hint.kubectl.1": "Set the kubectl path in Settings.",
  "error.hint.kubectl.2": "Or add kubectl to PATH: the portable build does not include it.",
  "error.hint.cluster.1": "Check that the kubeconfig file still exists.",
  "error.hint.cluster.2": "Check that the API server is reachable from this machine.",
  "error.hint.backend.1": "Retry the action.",
  "error.hint.backend.2": "If it repeats, open the logs from Settings and attach them to a bug report.",
  "error.hint.notFound.1": "The resource may have been deleted, restarted or replaced.",
  "error.hint.notFound.2": "Refresh the table and open the newest instance.",
};

export function ErrorPanel({ error, title, copyLabel, t }: Props) {
  if (!error) return null;
  const say = (key: string) => {
    const translated = t?.(key);
    return translated && translated !== key ? translated : (ENGLISH[key] ?? key);
  };
  const kind = classifyError(error);
  const scope = kind === "forbidden" ? forbiddenScope(error, say) : "";
  const hints = kind === "generic" ? [] : [say(`error.hint.${kind}.1`), say(`error.hint.${kind}.2`)];
  const text = [error.code, error.message, sanitizeCommandPreview(error.commandPreview), error.rawStderr].filter(Boolean).join("\n\n");
  const hasDetails = Boolean(error.code || error.commandPreview || error.rawStderr);
  return (
    <section className="error-panel" role="alert">
      <div className="error-header">
        <div>
          {/* A plain-language title; the code it replaced is in the details. */}
          <strong>{title ?? say(`error.kind.${kind}`)}</strong>
          {scope ? <p className="error-scope">{scope}</p> : null}
          <p>{error.message}</p>
        </div>
        <button className="icon-text" onClick={() => navigator.clipboard.writeText(text)} title={copyLabel}>
          <Copy size={15} />
          {copyLabel}
        </button>
      </div>
      {hints.length ? (
        <div className="error-hints">
          <strong>{say("error.whatToCheck")}</strong>
          <ul>
            {hints.map((hint) => (
              <li key={hint}>{hint}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {hasDetails ? (
        <details className="error-details">
          <summary>
            {say("error.details")}
            {error.code ? <code>{error.code}</code> : null}
          </summary>
          {error.commandPreview ? <CommandPreviewBlock command={error.commandPreview} /> : null}
          {error.rawStderr ? <pre>{error.rawStderr}</pre> : null}
        </details>
      ) : null}
    </section>
  );
}

export function classifyError(error: ErrorInfo): ErrorKind {
  const code = (error.code ?? "").toUpperCase();
  const text = `${error.message ?? ""}\n${error.rawStderr ?? ""}`.toLowerCase();
  if (code.includes("TIMEOUT") || text.includes("timed out") || text.includes("timeout")) return "timeout";
  if (code.includes("AUTH") || code.includes("FORBIDDEN") || text.includes("forbidden") || (text.includes("cannot") && text.includes("resource"))) return "forbidden";
  if (code.includes("KUBECTL_NOT_FOUND") || text.includes("kubectl not found")) return "kubectl";
  if (code.includes("CLUSTER_UNAVAILABLE") || code.includes("CLUSTER_NOT_FOUND")) return "cluster";
  if (code.includes("HTTP_ERROR") || text.includes("internal server error")) return "backend";
  if (text.includes("not found") || text.includes("notfound")) return "notFound";
  return "generic";
}

// kubectl says exactly what was refused: `User "x" cannot list resource
// "deployments" in API group "apps" in the namespace "team-a"`. Saying that
// back in the interface language tells the user what to change.
export function forbiddenScope(error: ErrorInfo, say: (key: string) => string): string {
  const text = `${error.message ?? ""}\n${error.rawStderr ?? ""}`;
  const match = text.match(/cannot (\w+) resource "([^"]+)"(?: in API group "[^"]*")?(?: in the namespace "([^"]+)")?/);
  if (!match) return "";
  const [, verb, resource, namespace] = match;
  const template = namespace ? say("error.forbiddenScope") : say("error.forbiddenScopeCluster");
  return template
    .replace("{verb}", verb)
    .replace("{resource}", resource)
    .replace("{namespace}", namespace ?? "");
}
