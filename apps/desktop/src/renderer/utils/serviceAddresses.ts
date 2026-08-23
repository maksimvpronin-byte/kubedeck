import type { ResourceRow } from "../types";

// Where a Service answers. Most of these are reachable only from inside the
// cluster - a ClusterIP is not routable from a laptop and `svc.cluster.local`
// does not resolve there - so they are addresses to copy into a neighbouring
// workload's configuration, not links to follow.
export interface ServiceAddress {
  group: string;
  address: string;
  hint: string;
}

const CLUSTER_DOMAIN = "svc.cluster.local";
const HTTP_PORTS = new Set([80, 8080, 8000, 8008, 8888]);
const HTTPS_PORTS = new Set([443, 8443, 9443]);

export interface ServicePort {
  name: string;
  port: number;
  targetPort: string;
  nodePort: number;
  protocol: string;
  appProtocol: string;
}

export function servicePorts(row: ResourceRow): ServicePort[] {
  const items = (row.servicePortItems ?? []) as Array<Partial<ServicePort>>;
  return items.filter(Boolean).map((item) => ({
    name: String(item.name ?? ""),
    port: Number(item.port ?? 0),
    targetPort: String(item.targetPort ?? ""),
    nodePort: Number(item.nodePort ?? 0),
    protocol: String(item.protocol ?? "TCP"),
    appProtocol: String(item.appProtocol ?? ""),
  }));
}

// A scheme is only written when the port says what it speaks - by its name, by
// appProtocol, or by being one of the numbers everybody uses for it. Guessing
// `http://` onto a database port would produce an address that cannot work.
export function portScheme(port: ServicePort): string {
  const spoken = `${port.appProtocol} ${port.name}`.toLowerCase();
  if (port.protocol.toUpperCase() === "UDP") return "";
  if (/\bhttps\b/.test(spoken) || HTTPS_PORTS.has(port.port)) return "https";
  if (/\bhttp\b/.test(spoken) || HTTP_PORTS.has(port.port)) return "http";
  return "";
}

export function serviceHost(row: ResourceRow): string {
  return `${String(row.name ?? "")}.${String(row.namespace ?? "default")}.${CLUSTER_DOMAIN}`;
}

function addressFor(host: string, port: ServicePort): string {
  const scheme = portScheme(port);
  return scheme ? `${scheme}://${host}:${port.port}` : `${host}:${port.port}`;
}

function portHint(port: ServicePort): string {
  return [port.name, port.protocol].filter(Boolean).join(" · ");
}

export function serviceAddresses(row: ResourceRow): ServiceAddress[] {
  const ports = servicePorts(row);
  const type = String(row.type ?? "");
  const clusterIp = String(row.clusterIp ?? "");
  const headless = clusterIp === "None";
  const addresses: ServiceAddress[] = [];

  if (type === "ExternalName") {
    const target = String(row.externalName ?? "");
    // Nothing else applies: the cluster answers this name with a CNAME and the
    // connection goes wherever that points.
    return target ? [{ group: "ExternalName", address: target, hint: "the cluster resolves this Service to this name" }] : [];
  }

  const host = serviceHost(row);
  for (const port of ports) {
    addresses.push({ group: "Cluster DNS", address: addressFor(host, port), hint: portHint(port) });
  }
  if (ports.length === 0) addresses.push({ group: "Cluster DNS", address: host, hint: "the Service declares no ports" });

  if (headless) {
    addresses.push({ group: "Headless", address: host, hint: "resolves to the pod addresses, not to one address" });
  } else if (clusterIp) {
    for (const port of ports) {
      addresses.push({ group: "ClusterIP", address: addressFor(clusterIp, port), hint: portHint(port) });
    }
  }

  for (const port of ports.filter((item) => item.nodePort > 0)) {
    addresses.push({ group: "NodePort", address: `<node-ip>:${port.nodePort}`, hint: `${portHint(port)} · on any node of the cluster` });
  }

  for (const external of [...((row.loadBalancerAddresses ?? []) as string[]), ...((row.externalIps ?? []) as string[])]) {
    for (const port of ports) {
      addresses.push({ group: "External", address: addressFor(external, port), hint: portHint(port) });
    }
  }

  return mergeByAddress(addresses);
}

// Two ports can share a number on different protocols - 53/UDP and 53/TCP is
// the usual pair - and printing the same address twice reads as a mistake.
function mergeByAddress(addresses: ServiceAddress[]): ServiceAddress[] {
  const merged: ServiceAddress[] = [];
  for (const address of addresses) {
    const existing = merged.find((item) => item.group === address.group && item.address === address.address);
    if (!existing) merged.push({ ...address });
    else if (address.hint && !existing.hint.includes(address.hint)) existing.hint = [existing.hint, address.hint].filter(Boolean).join(", ");
  }
  return merged;
}

// What reaches the Service from the machine KubeDeck runs on, which none of the
// addresses above do. The drawer's port-forward button does the same thing.
export function portForwardCommand(row: ResourceRow): string {
  const ports = servicePorts(row);
  const port = ports[0]?.port;
  if (!port) return "";
  const namespace = String(row.namespace ?? "");
  const namespaceArg = namespace && namespace !== "_cluster" ? `-n ${namespace} ` : "";
  return `kubectl port-forward ${namespaceArg}svc/${String(row.name ?? "")} ${port}:${port}`;
}
