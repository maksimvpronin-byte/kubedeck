// Failures of a direct API request, worded the way kubectl words them.
//
// The window tells "cluster unreachable" from "not allowed" from "not found" by
// the code and by phrases in rawStderr (`isClusterUnavailableError`,
// `isPermissionError` in the renderer). A request that no longer goes through
// kubectl has to fail with the same code and a text that carries the same
// phrases, or a dropped VPN stops looking like one.

import { classifyKubectlError, KubectlError, sanitizeKubectlText, truncateKubectlText } from "../kubectl/errors";

function kubectlError(code: string, rawStderr: string, commandPreview: string, message = "kubectl command failed"): KubectlError {
  return new KubectlError({ code, message, rawStderr: truncateKubectlText(sanitizeKubectlText(rawStderr)), commandPreview });
}

const STATUS_REASONS: Record<number, string> = {
  400: "BadRequest",
  401: "Unauthorized",
  403: "Forbidden",
  404: "NotFound",
  405: "MethodNotAllowed",
  409: "Conflict",
  410: "Gone",
  422: "Invalid",
  429: "TooManyRequests",
  500: "InternalError",
  503: "ServiceUnavailable",
  504: "Timeout",
};

// An answer from the API server that is not a success.
export function statusError(statusCode: number, body: string, commandPreview: string): KubectlError {
  let reason = STATUS_REASONS[statusCode] ?? "";
  let message = "";
  try {
    const status: unknown = JSON.parse(body);
    if (status && typeof status === "object") {
      const record = status as Record<string, unknown>;
      if (typeof record.reason === "string" && record.reason) reason = record.reason;
      if (typeof record.message === "string") message = record.message;
    }
  } catch {
    message = body.trim().slice(0, 2000);
  }
  if (statusCode === 401) {
    return kubectlError("UNAUTHORIZED", "error: You must be logged in to the server (Unauthorized)", commandPreview);
  }
  if (statusCode === 404 && !message) message = "the server could not find the requested resource";
  const text = `Error from server${reason ? ` (${reason})` : ""}: ${message || `status ${statusCode}`}`;
  const code = statusCode === 403 ? "FORBIDDEN" : statusCode === 404 ? "NOT_FOUND" : statusCode === 409 ? "CONFLICT" : classifyKubectlError(text);
  return kubectlError(code, text, commandPreview);
}

const TLS_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "CERT_UNTRUSTED",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_SIGNATURE_FAILURE",
]);

// Failures where kubectl might still succeed: our TLS stack or our proxy
// handling disagreeing with Go's. These fall back to kubectl instead of being
// reported.
export function isTransportSetupError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code ?? "";
  return TLS_CODES.has(code) || code === "ERR_PROXY_TUNNEL" || code.startsWith("ERR_SSL_") || code.startsWith("ERR_OSSL_") || code === "ERR_INVALID_PROXY_URL";
}

// A failure to reach or talk to the server at all.
export function networkError(error: unknown, server: URL, commandPreview: string): KubectlError {
  const code = (error as NodeJS.ErrnoException | undefined)?.code ?? "";
  const host = server.port ? `${server.hostname}:${server.port}` : server.hostname;
  const dial = `Unable to connect to the server: dial tcp ${host}`;
  switch (code) {
    case "ECONNREFUSED":
      return kubectlError("CLUSTER_UNAVAILABLE", `${dial}: connect: connection refused`, commandPreview);
    case "EHOSTUNREACH":
      return kubectlError("CLUSTER_UNAVAILABLE", `${dial}: connect: no route to host`, commandPreview);
    case "ENETUNREACH":
      return kubectlError("KUBECTL_COMMAND_FAILED", `${dial}: connect: network is unreachable`, commandPreview);
    case "ENOTFOUND":
      return kubectlError("KUBECTL_COMMAND_FAILED", `Unable to connect to the server: dial tcp: lookup ${server.hostname}: no such host`, commandPreview);
    case "EAI_AGAIN":
      return kubectlError("KUBECTL_COMMAND_FAILED", `Unable to connect to the server: dial tcp: lookup ${server.hostname}: temporary failure in name resolution`, commandPreview);
    case "ETIMEDOUT":
    case "ECONNECT_TIMEOUT":
      return kubectlError("CLUSTER_UNAVAILABLE", `${dial}: i/o timeout`, commandPreview);
    case "ECONNRESET":
    case "EPIPE":
      return kubectlError("KUBECTL_COMMAND_FAILED", `Unable to connect to the server: read tcp ${host}: connection reset by peer`, commandPreview);
    default:
      break;
  }
  if (TLS_CODES.has(code)) {
    const expired = code === "CERT_HAS_EXPIRED" || code === "CERT_NOT_YET_VALID";
    return kubectlError(
      "TLS_ERROR",
      expired
        ? "Unable to connect to the server: tls: failed to verify certificate: x509: certificate has expired or is not yet valid"
        : "Unable to connect to the server: tls: failed to verify certificate: x509: certificate signed by unknown authority",
      commandPreview,
    );
  }
  const detail = error instanceof Error ? error.message : String(error);
  return kubectlError(classifyKubectlError(detail), `Unable to connect to the server: ${detail}`, commandPreview);
}

// The request did not finish in time; kubectl's own `--request-timeout` says this.
export function timeoutError(server: URL, path: string, seconds: number, commandPreview: string): KubectlError {
  return kubectlError(
    "TIMEOUT",
    `Get "${new URL(path, server).href}": context deadline exceeded (Client.Timeout exceeded after ${seconds}s)`,
    commandPreview,
    `kubectl command timed out after ${seconds}s`,
  );
}

export function cancelledError(commandPreview: string): KubectlError {
  return new KubectlError({ code: "KUBECTL_CANCELLED", message: "kubectl command cancelled", rawStderr: "", commandPreview });
}

export function tooLargeError(totalBytes: number, maxBytes: number, commandPreview: string): KubectlError {
  return new KubectlError({
    code: "OUTPUT_TOO_LARGE",
    message: `kubectl output is too large (${totalBytes} bytes, limit ${maxBytes} bytes). Narrow the namespace/resource or reduce logs tail.`,
    rawStderr: "",
    commandPreview,
  });
}
