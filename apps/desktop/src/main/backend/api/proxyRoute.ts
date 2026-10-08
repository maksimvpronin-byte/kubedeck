// Whether a request to the API server goes through an HTTP proxy, decided the
// way kubectl (Go's ProxyFromEnvironment) decides it.
//
// Node's built-in proxy support reads NO_PROXY too, but not the CIDR entries
// KubeDeck itself adds there for private networks (`kubectlEnvironment()`), so
// a cluster on 10.x would be sent to the corporate proxy that kubectl
// bypasses. Each agent talks to one host, so the decision is made once here and
// the agent gets either a proxy or none.

import net from "node:net";

function ipToBigInt(address: string): { value: bigint; bits: number } | null {
  if (net.isIPv4(address)) {
    return { value: address.split(".").reduce((acc, part) => (acc << 8n) + BigInt(Number(part)), 0n), bits: 32 };
  }
  if (net.isIPv6(address)) {
    const [head, tail = ""] = address.split("::");
    const headParts = head ? head.split(":") : [];
    const tailParts = tail ? tail.split(":") : [];
    const missing = 8 - headParts.length - tailParts.length;
    const parts = [...headParts, ...Array(Math.max(0, missing)).fill("0"), ...tailParts];
    if (parts.length !== 8) return null;
    return { value: parts.reduce((acc, part) => (acc << 16n) + BigInt(Number.parseInt(part || "0", 16)), 0n), bits: 128 };
  }
  return null;
}

function inCidr(host: string, cidr: string): boolean {
  const [base, prefixText] = cidr.split("/");
  const address = ipToBigInt(host);
  const network = ipToBigInt(base);
  const prefix = Number(prefixText);
  if (!address || !network || address.bits !== network.bits || !Number.isInteger(prefix) || prefix < 0 || prefix > address.bits) return false;
  const shift = BigInt(address.bits - prefix);
  return address.value >> shift === network.value >> shift;
}

export function bypassesProxy(host: string, port: string, noProxy: string): boolean {
  const target = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (target === "localhost" || target === "127.0.0.1" || target === "::1") return true;
  for (const raw of noProxy.split(",")) {
    let entry = raw.trim().toLowerCase();
    if (!entry) continue;
    if (entry === "*") return true;
    if (entry.includes("/")) {
      if (inCidr(target, entry)) return true;
      continue;
    }
    let entryPort = "";
    const portMatch = /^(.*):(\d+)$/.exec(entry);
    if (portMatch && !net.isIPv6(entry)) {
      entry = portMatch[1];
      entryPort = portMatch[2];
    }
    entry = entry.replace(/^\[|\]$/g, "");
    if (entryPort && entryPort !== port) continue;
    if (net.isIP(entry)) {
      if (entry === target) return true;
      continue;
    }
    const domain = entry.replace(/^\*?\./, "");
    if (target === domain || target.endsWith(`.${domain}`)) return true;
  }
  return false;
}

// The proxy URL for this server, or null for a direct connection.
export function proxyFor(server: URL, kubeconfigProxyUrl: string | null, environment: NodeJS.ProcessEnv): string | null {
  // An explicit proxy-url applies to everything, NO_PROXY included, as in client-go.
  if (kubeconfigProxyUrl) return kubeconfigProxyUrl;
  const https = server.protocol === "https:";
  const proxy = (https ? environment.HTTPS_PROXY || environment.https_proxy : environment.HTTP_PROXY || environment.http_proxy) || "";
  if (!proxy.trim()) return null;
  const port = server.port || (https ? "443" : "80");
  if (bypassesProxy(server.hostname, port, environment.NO_PROXY ?? environment.no_proxy ?? "")) return null;
  const normalized = /^[a-z][a-z0-9+.-]*:\/\//i.test(proxy.trim()) ? proxy.trim() : `http://${proxy.trim()}`;
  return normalized;
}
