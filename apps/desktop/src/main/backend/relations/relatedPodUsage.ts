import { record, records, text, type UnknownRecord } from "./relatedResourceValues";

export function podUsesPvc(pod: UnknownRecord, claimName: string): boolean {
  return records(record(pod.spec).volumes).some((volume) => text(record(volume.persistentVolumeClaim).claimName) === claimName);
}

export function podUsesConfigResource(pod: UnknownRecord, refKind: "configMap" | "secret", name: string): string {
  const spec = record(pod.spec);
  const volumeField = refKind === "configMap" ? "configMap" : "secret";
  const nameField = refKind === "configMap" ? "name" : "secretName";
  for (const volume of records(spec.volumes)) {
    if (text(record(volume[volumeField])[nameField]) === name) return "mounted by pod";
  }
  for (const container of [...records(spec.containers), ...records(spec.initContainers)]) {
    for (const envFrom of records(container.envFrom)) {
      if (text(record(envFrom[`${refKind}Ref`]).name) === name) return "used by envFrom";
    }
    for (const env of records(container.env)) {
      if (text(record(record(env.valueFrom)[`${refKind}KeyRef`]).name) === name) return "used by environment variable";
    }
  }
  return "";
}
