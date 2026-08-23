import { type JsonObject, meta, numberValue, record, records, type ResourceRow, strings, text } from "./primitives";

export interface ServicePortItem {
  name: string;
  port: number;
  targetPort: string;
  nodePort: number;
  protocol: string;
  appProtocol: string;
}

// The ports were only ever a formatted string, which is enough to print in a
// cell and not enough to build an address out of. The pieces travel too now,
// along with the addresses a Service answers on outside the cluster.
export function servicePortItems(portsValue: unknown): ServicePortItem[] {
  return records(portsValue).map((port) => ({
    name: text(port.name),
    port: Math.trunc(numberValue(port.port)),
    targetPort: String(port.targetPort ?? port.port ?? ""),
    nodePort: Math.trunc(numberValue(port.nodePort)),
    protocol: text(port.protocol, "TCP"),
    appProtocol: text(port.appProtocol),
  }));
}

export function loadBalancerAddresses(statusValue: unknown): string[] {
  const loadBalancer = record(record(statusValue).loadBalancer);
  return records(loadBalancer.ingress)
    .map((ingress) => text(ingress.ip) || text(ingress.hostname))
    .filter(Boolean);
}

function stringList(value: unknown): string[] {
  return (Array.isArray(value) ? value : []).map((entry) => String(entry ?? "")).filter(Boolean);
}

export function serviceSummary(item: JsonObject): ResourceRow {
  const spec = record(item.spec);
  const ports = records(spec.ports);
  const selector = record(spec.selector);
  return {
    ...meta(item),
    type: text(spec.type),
    clusterIp: text(spec.clusterIP),
    servicePortItems: servicePortItems(spec.ports),
    externalName: text(spec.externalName),
    externalIps: stringList(spec.externalIPs),
    loadBalancerAddresses: loadBalancerAddresses(item.status),
    ports: ports
      .map((port) => {
        const name = text(port.name);
        const source = String(port.port ?? "");
        const target = String(port.targetPort ?? source);
        const protocol = text(port.protocol, "TCP");
        return `${name ? `${name} · ` : ""}${source} → ${target}/${protocol}`;
      })
      .filter(Boolean)
      .join(", "),
    selector,
    selectorText: Object.entries(selector)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(", "),
  };
}

function serviceNameFromBackend(backend: JsonObject): string {
  const service = record(backend.service);
  return text(service.name) || text(backend.serviceName);
}

function ingressBackendServices(spec: JsonObject): string[] {
  const names: string[] = [];
  const defaultName = serviceNameFromBackend(record(spec.defaultBackend));
  if (defaultName) names.push(defaultName);

  for (const rule of records(spec.rules)) {
    const http = record(rule.http);
    for (const path of records(http.paths)) {
      const backendName = serviceNameFromBackend(record(path.backend));
      if (backendName) names.push(backendName);
    }
  }

  return names;
}

export function ingressSummary(item: JsonObject): ResourceRow {
  const spec = record(item.spec);
  const status = record(item.status);
  const loadBalancer = record(status.loadBalancer);
  const services = [...new Set(ingressBackendServices(spec))].sort();
  return {
    ...meta(item),
    kind: text(item.kind, "Ingress"),
    className: text(spec.ingressClassName),
    hosts: records(spec.rules)
      .map((rule) => text(rule.host))
      .filter(Boolean)
      .join(", "),
    backendServices: services,
    backendServicesText: services.join(", "),
    routes: records(spec.rules)
      .flatMap((rule) => records(record(rule.http).paths).map((path) => `${text(rule.host) || "*"}${text(path.path, "/")} → ${serviceNameFromBackend(record(path.backend))}`))
      .join(", "),
    tlsHosts: records(spec.tls)
      .flatMap((tls) => strings(tls.hosts))
      .join(", "),
    addressesText: records(loadBalancer.ingress)
      .map((address) => text(address.ip) || text(address.hostname))
      .filter(Boolean)
      .join(", "),
  };
}
