type JsonObject = Record<string, unknown>;

// A busy Service can back thousands of addresses. The counts stay exact while
// the list itself is capped, so the drawer never carries a huge payload.
export const MAX_SERVICE_ENDPOINT_ITEMS = 100;

export interface ServiceEndpointEntry {
  address: string;
  ports: string;
  target: string;
  node: string;
  zone: string;
  ready: boolean;
}

export interface ServiceEndpointsSummary {
  items: ServiceEndpointEntry[];
  ready: number;
  notReady: number;
  total: number;
  truncated: boolean;
}

function record(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function records(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter((item): item is JsonObject => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function text(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

function slicePortsText(slice: JsonObject): string {
  return records(slice.ports)
    .map((port) => {
      const number = text(port.port);
      const protocol = text(port.protocol) || "TCP";
      const name = text(port.name);
      if (!number) return "";
      return `${name ? `${name} ` : ""}${number}/${protocol}`;
    })
    .filter(Boolean)
    .join(", ");
}

function targetText(endpoint: JsonObject): string {
  const target = record(endpoint.targetRef);
  const name = text(target.name);
  if (!name) return "";
  const kind = text(target.kind);
  return kind && kind !== "Pod" ? `${kind}/${name}` : name;
}

export function normalizeServiceEndpoints(payload: unknown): ServiceEndpointsSummary {
  const items: ServiceEndpointEntry[] = [];
  let ready = 0;
  let notReady = 0;

  for (const slice of records(record(payload).items)) {
    const ports = slicePortsText(slice);
    for (const endpoint of records(slice.endpoints)) {
      const conditions = record(endpoint.conditions);
      // An absent condition means ready: EndpointSlice only sets it explicitly.
      const isReady = conditions.ready !== false;
      const target = targetText(endpoint);
      const node = text(endpoint.nodeName);
      const zone = text(endpoint.zone);
      for (const address of Array.isArray(endpoint.addresses) ? endpoint.addresses : []) {
        const value = text(address);
        if (!value) continue;
        if (isReady) ready += 1;
        else notReady += 1;
        if (items.length < MAX_SERVICE_ENDPOINT_ITEMS) items.push({ address: value, ports, target, node, zone, ready: isReady });
      }
    }
  }

  const total = ready + notReady;
  return { items, ready, notReady, total, truncated: total > items.length };
}
