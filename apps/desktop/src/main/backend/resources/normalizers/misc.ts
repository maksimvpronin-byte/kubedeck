import { type JsonObject, meta, record, records, type ResourceRow, strings, text } from "./primitives";

export function keyValueSummary(item: JsonObject): ResourceRow {
  const data = record(item.data);
  const stringData = record(item.stringData);
  const keys = Array.from(new Set([...Object.keys(data), ...Object.keys(stringData)])).sort();
  return {
    ...meta(item),
    kind: text(item.kind),
    type: text(item.type),
    immutable: item.immutable === true,
    keyCount: keys.length,
    keyNames: keys.join(", "),
  };
}

export function storageSummary(item: JsonObject): ResourceRow {
  const spec = record(item.spec);
  const status = record(item.status);
  const resources = record(spec.resources);
  const requests = record(resources.requests);
  const claimRef = record(spec.claimRef);
  return {
    ...meta(item),
    status: text(status.phase),
    capacity: String(record(status.capacity).storage ?? record(spec.capacity).storage ?? requests.storage ?? ""),
    accessModes: strings(spec.accessModes).join(", "),
    storageClassName: text(spec.storageClassName),
    volumeName: text(spec.volumeName),
    claim: [text(claimRef.namespace), text(claimRef.name)].filter(Boolean).join("/"),
    reclaimPolicy: text(spec.persistentVolumeReclaimPolicy) || text(item.reclaimPolicy),
    provisioner: text(item.provisioner),
    volumeBindingMode: text(item.volumeBindingMode),
    allowVolumeExpansion: item.allowVolumeExpansion,
  };
}

export function crdSummary(item: JsonObject): ResourceRow {
  const spec = record(item.spec);
  const names = record(spec.names);
  const servedVersions = records(spec.versions)
    .filter((version) => version.served === true)
    .map((version) => text(version.name))
    .filter(Boolean);
  const plural = text(names.plural);
  const group = text(spec.group);

  return {
    ...meta(item),
    kind: text(names.kind),
    plural,
    singular: text(names.singular),
    shortNames: strings(names.shortNames).join(", "),
    group,
    scope: text(spec.scope),
    versions: servedVersions.join(", "),
    resourceName: `${plural}.${group}`.replace(/^\./, "").replace(/\.$/, ""),
  };
}

export function eventSummary(item: JsonObject): ResourceRow {
  const base = meta(item);
  const involved = record(item.involvedObject);
  const series = record(item.series);
  const source = record(item.source);
  const eventTime = text(item.lastTimestamp) || text(item.eventTime) || text(item.firstTimestamp) || text(base.createdAt);

  return {
    ...base,
    type: text(item.type),
    reason: text(item.reason),
    message: text(item.message),
    object: `${text(involved.kind)}/${text(involved.name)}`,
    involvedKind: text(involved.kind),
    involvedName: text(involved.name),
    involvedNamespace: text(involved.namespace) || text(base.namespace),
    involvedApiVersion: text(involved.apiVersion),
    count: item.count ?? series.count ?? 1,
    source: text(source.component) || text(item.reportingController),
    createdAt: eventTime,
    lastTimestamp: eventTime,
  };
}

export function genericSummary(item: JsonObject): ResourceRow {
  const base = meta(item);
  const status = record(item.status);
  const spec = record(item.spec);
  const conditions = records(status.conditions);
  const lastCondition = conditions.at(-1) ?? {};

  return {
    ...base,
    apiVersion: text(item.apiVersion),
    kind: text(item.kind),
    status: text(status.phase) || (Object.keys(status).length > 0 ? text(lastCondition.type) : ""),
    type: text(spec.type),
  };
}

export function resourceQuotaSummary(item: JsonObject): ResourceRow {
  const spec = record(item.spec);
  const status = record(item.status);
  const hard = record(status.hard);
  const used = record(status.used);
  const resources = Array.from(new Set([...Object.keys(hard), ...Object.keys(used)])).sort();
  return {
    ...meta(item),
    apiVersion: text(item.apiVersion),
    kind: text(item.kind, "ResourceQuota"),
    status: resources.length ? "Active" : "Pending",
    quotaUsage: resources.map((resource) => ({ resource, used: String(used[resource] ?? "0"), hard: String(hard[resource] ?? "") })),
    scopes: strings(spec.scopes),
    scopeSelector: record(spec.scopeSelector),
  };
}
