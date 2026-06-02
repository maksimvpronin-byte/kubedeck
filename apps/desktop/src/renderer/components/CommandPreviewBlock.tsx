import { Copy } from "lucide-react";
import { useMemo, useState } from "react";

interface Props {
  command: string;
  label?: string;
  copyLabel?: string;
}

export function CommandPreviewBlock({ command, label = "Command preview", copyLabel = "Copy command" }: Props) {
  const [copied, setCopied] = useState(false);
  const safeCommand = useMemo(() => sanitizeCommandPreview(command), [command]);

  if (!safeCommand) return null;

  async function copyCommand() {
    await navigator.clipboard.writeText(safeCommand);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="command-preview-block">
      <div className="command-preview-header">
        <span>{label}</span>
        <button className="icon-text" onClick={copyCommand} title={copyLabel}>
          <Copy size={14} />
          {copied ? "Copied" : copyLabel}
        </button>
      </div>
      <pre><code>{safeCommand}</code></pre>
    </div>
  );
}

export function sanitizeCommandPreview(command: string): string {
  let safe = String(command || "").trim();
  if (!safe) return "";

  safe = safe.replace(/(--kubeconfig(?:=|\s+))(?:(?:"[^"]+")|(?:'[^']+')|\S+)/gi, "$1[redacted-kubeconfig]");
  safe = safe.replace(/(--(?:token|password|passwd|client-key|client-certificate|certificate-authority)(?:=|\s+))(?:(?:"[^"]+")|(?:'[^']+')|\S+)/gi, "$1[redacted]");
  safe = safe.replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]");

  return safe;
}
