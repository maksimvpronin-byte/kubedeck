import { relatedLink, type RelatedLink } from "./relatedResourceLinks";
import { resourceForKind } from "./relatedResourceKinds";
import {
  metadata,
  record,
  records,
  text,
  type UnknownRecord,
} from "./relatedResourceValues";

export function endpointSliceServiceName(endpointSlice: UnknownRecord): string {
  return text(record(metadata(endpointSlice).labels)["kubernetes.io/service-name"]);
}

export function endpointSliceAddressDetail(endpointSlice: UnknownRecord): string {
  const parts: string[] = [];
  const endpointCount = records(endpointSlice.endpoints).length;
  const portCount = records(endpointSlice.ports).length;
  if (endpointCount) parts.push(`${endpointCount} endpoints`);
  if (portCount) parts.push(`${portCount} ports`);
  return parts.join(", ");
}

export function endpointAddressLinks(
  endpoints: UnknownRecord,
  namespace: string,
): RelatedLink[] {
  const links: RelatedLink[] = [];
  for (const subset of records(endpoints.subsets)) {
    for (const address of records(subset.addresses)) {
      const targetRef = record(address.targetRef);
      const kind = text(targetRef.kind);
      const name = text(targetRef.name);
      const resource = resourceForKind(kind);
      if (!resource || !name) continue;
      links.push(
        relatedLink(
          resource,
          text(targetRef.namespace) || namespace,
          name,
          kind,
          "endpoint target",
          text(address.ip),
        ),
      );
    }
  }
  return links;
}

export function endpointSliceAddressLinks(
  endpointSlice: UnknownRecord,
  namespace: string,
): RelatedLink[] {
  const links: RelatedLink[] = [];
  for (const endpoint of records(endpointSlice.endpoints)) {
    const targetRef = record(endpoint.targetRef);
    const kind = text(targetRef.kind);
    const name = text(targetRef.name);
    const resource = resourceForKind(kind);
    if (!resource || !name) continue;
    const addresses = Array.isArray(endpoint.addresses)
      ? endpoint.addresses.map(text).filter(Boolean).join(",")
      : "";
    links.push(
      relatedLink(
        resource,
        text(targetRef.namespace) || namespace,
        name,
        kind,
        "endpoint slice target",
        addresses,
      ),
    );
  }
  return links;
}
