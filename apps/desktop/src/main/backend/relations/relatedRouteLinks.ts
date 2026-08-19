import { relatedLink, type RelatedLink } from "./relatedResourceLinks";
import { record, records, text, type UnknownRecord } from "./relatedResourceValues";

export interface RouteBackendRef {
  name: string;
  namespace: string;
  kind: string;
  port: string;
}

// Reverse lookups have to guess which CRDs a cluster serves, so they take the
// resource names discovery reported. Forward lookups read the group from the
// target manifest instead and stay correct even when discovery is unavailable.
export interface RouteCatalog {
  ingressRoutes: string;
  ingressRouteTcps: string;
  ingressRouteUdps: string;
  httpRoutes: string;
  gateways: string;
}

const TRAEFIK_GROUPS = ["traefik.io", "traefik.containo.us"] as const;
const GATEWAY_GROUP = "gateway.networking.k8s.io";

export function qualifiedResource(plural: string, group: string): string {
  return group ? `${plural}.${group}` : plural;
}

export function apiGroupOf(item: UnknownRecord): string {
  const parts = text(item.apiVersion).split("/");
  return parts.length > 1 ? parts[0] : "";
}

export function routeCatalog(available: ReadonlySet<string>): RouteCatalog {
  const traefikGroup = TRAEFIK_GROUPS.find((group) => available.has(`ingressroutes.${group}`)) ?? "";
  const traefikResource = (plural: string) => (traefikGroup && available.has(`${plural}.${traefikGroup}`) ? `${plural}.${traefikGroup}` : "");
  const gatewayResource = (plural: string) => (available.has(`${plural}.${GATEWAY_GROUP}`) ? `${plural}.${GATEWAY_GROUP}` : "");
  return {
    ingressRoutes: traefikResource("ingressroutes"),
    ingressRouteTcps: traefikResource("ingressroutetcps"),
    ingressRouteUdps: traefikResource("ingressrouteudps"),
    httpRoutes: gatewayResource("httproutes"),
    gateways: gatewayResource("gateways"),
  };
}

function portDetail(ref: RouteBackendRef): string {
  return ref.port ? `port ${ref.port}` : "";
}

export function traefikServiceRefs(route: UnknownRecord, fallbackNamespace: string): RouteBackendRef[] {
  return records(record(route.spec).routes)
    .flatMap((rule) => records(rule.services))
    .map((service) => ({
      name: text(service.name),
      namespace: text(service.namespace) || fallbackNamespace,
      kind: text(service.kind) || "Service",
      port: text(service.port),
    }))
    .filter((ref) => Boolean(ref.name));
}

export function traefikMiddlewareRefs(route: UnknownRecord, fallbackNamespace: string): Array<{ name: string; namespace: string }> {
  return records(record(route.spec).routes)
    .flatMap((rule) => records(rule.middlewares))
    .map((middleware) => ({ name: text(middleware.name), namespace: text(middleware.namespace) || fallbackNamespace }))
    .filter((ref) => Boolean(ref.name));
}

export function traefikTlsSecretNames(route: UnknownRecord): string[] {
  const tls = record(record(route.spec).tls);
  return [text(tls.secretName)].filter(Boolean);
}

export function httpRouteBackendRefs(route: UnknownRecord, fallbackNamespace: string): RouteBackendRef[] {
  const refs: RouteBackendRef[] = [];
  const collect = (value: unknown) => {
    const ref = record(value);
    const name = text(ref.name);
    if (!name) return;
    refs.push({ name, namespace: text(ref.namespace) || fallbackNamespace, kind: text(ref.kind) || "Service", port: text(ref.port) });
  };
  for (const rule of records(record(route.spec).rules)) {
    for (const backend of records(rule.backendRefs)) collect(backend);
    for (const filter of records(rule.filters)) collect(record(filter.requestMirror).backendRef);
  }
  return refs;
}

export function httpRouteParentRefs(route: UnknownRecord, fallbackNamespace: string): Array<{ name: string; namespace: string; sectionName: string }> {
  return records(record(route.spec).parentRefs)
    .filter((ref) => (text(ref.kind) || "Gateway") === "Gateway")
    .map((ref) => ({ name: text(ref.name), namespace: text(ref.namespace) || fallbackNamespace, sectionName: text(ref.sectionName) }))
    .filter((ref) => Boolean(ref.name));
}

export function gatewayCertificateRefs(gateway: UnknownRecord, fallbackNamespace: string): Array<{ name: string; namespace: string; listener: string }> {
  return records(record(gateway.spec).listeners).flatMap((listener) =>
    records(record(listener.tls).certificateRefs)
      .filter((ref) => (text(ref.kind) || "Secret") === "Secret")
      .map((ref) => ({ name: text(ref.name), namespace: text(ref.namespace) || fallbackNamespace, listener: text(listener.name) }))
      .filter((ref) => Boolean(ref.name)),
  );
}

export function ingressTlsSecretNames(ingress: UnknownRecord): string[] {
  return records(record(ingress.spec).tls)
    .map((entry) => text(entry.secretName))
    .filter(Boolean);
}

function matchedServiceNames(refs: RouteBackendRef[], names: ReadonlySet<string>, namespace: string): string[] {
  const matched = new Set<string>();
  for (const ref of refs) {
    if (ref.kind !== "Service" || ref.namespace !== namespace) continue;
    if (names.has(ref.name)) matched.add(ref.name);
  }
  return [...matched];
}

// `routeNamespace` is the namespace the candidate route object actually lives
// in (used only as the fallback when one of its refs omits `namespace`);
// `serviceNamespace` is the namespace a match must resolve to. They differ
// whenever a route references a Service in another namespace, which Traefik
// and Gateway API both allow.
export function traefikRouteServiceMatches(route: UnknownRecord, routeNamespace: string, names: ReadonlySet<string>, serviceNamespace: string): string[] {
  return matchedServiceNames(traefikServiceRefs(route, routeNamespace), names, serviceNamespace);
}

export function httpRouteServiceMatches(route: UnknownRecord, routeNamespace: string, names: ReadonlySet<string>, serviceNamespace: string): string[] {
  return matchedServiceNames(httpRouteBackendRefs(route, routeNamespace), names, serviceNamespace);
}

export function traefikRouteReferenceLinks(route: UnknownRecord, namespace: string, middlewarePlural: string): RelatedLink[] {
  const group = apiGroupOf(route);
  const middlewareKind = middlewarePlural === "middlewaretcps" ? "MiddlewareTCP" : "Middleware";
  const links: RelatedLink[] = [];
  for (const ref of traefikServiceRefs(route, namespace)) {
    if (ref.kind === "TraefikService") {
      links.push(relatedLink(qualifiedResource("traefikservices", group), ref.namespace, ref.name, "TraefikService", "used by route", portDetail(ref)));
    } else {
      links.push(relatedLink("services", ref.namespace, ref.name, "Service", "used by route", portDetail(ref)));
    }
  }
  for (const ref of traefikMiddlewareRefs(route, namespace)) {
    links.push(relatedLink(qualifiedResource(middlewarePlural, group), ref.namespace, ref.name, middlewareKind, "uses middleware"));
  }
  for (const secretName of traefikTlsSecretNames(route)) {
    links.push(relatedLink("secrets", namespace, secretName, "Secret", "tls certificate"));
  }
  return links;
}

export function httpRouteReferenceLinks(route: UnknownRecord, namespace: string): RelatedLink[] {
  const group = apiGroupOf(route) || GATEWAY_GROUP;
  const links: RelatedLink[] = [];
  for (const ref of httpRouteBackendRefs(route, namespace)) {
    if (ref.kind !== "Service") continue;
    links.push(relatedLink("services", ref.namespace, ref.name, "Service", "used by route", portDetail(ref)));
  }
  for (const ref of httpRouteParentRefs(route, namespace)) {
    links.push(relatedLink(qualifiedResource("gateways", group), ref.namespace, ref.name, "Gateway", "attached to gateway", ref.sectionName ? `listener ${ref.sectionName}` : ""));
  }
  return links;
}

export function gatewayReferenceLinks(gateway: UnknownRecord, namespace: string): RelatedLink[] {
  const group = apiGroupOf(gateway) || GATEWAY_GROUP;
  const links: RelatedLink[] = [];
  const className = text(record(gateway.spec).gatewayClassName);
  if (className) links.push(relatedLink(qualifiedResource("gatewayclasses", group), "_cluster", className, "GatewayClass", "gateway class"));
  for (const ref of gatewayCertificateRefs(gateway, namespace)) {
    links.push(relatedLink("secrets", ref.namespace, ref.name, "Secret", "tls certificate", ref.listener ? `listener ${ref.listener}` : ""));
  }
  return links;
}
