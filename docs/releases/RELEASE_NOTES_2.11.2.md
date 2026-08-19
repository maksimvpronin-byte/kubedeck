# KubeDeck 2.11.2 release notes

KubeDeck 2.11.2 is a patch release built around one gap and several pieces of
polish in the resource drawer: the Related tab did not know about Traefik or
Gateway API routing at all, a Service did not show what actually backs it, the
drawer forgot which tab you were on every time you opened another object, and
the YAML tab made you press Edit before you could type.

One new operation on an existing route (`GET
/clusters/{cluster_id}/resources/{resource}/{namespace}/{name}/endpoints`).
Node-only ownership stays at Node 56 / Python 0.

## Related did not show Traefik IngressRoutes or Gateway API routes

The Related tab only understood the built-in `Ingress`, and only ever asked
for it from a Service. On a cluster where routing lives in Traefik
`IngressRoute` objects or in Gateway API `HTTPRoute` objects — which is to say
most clusters running an ingress controller of their own — a Service showed no
routing at all, and a Pod showed no routing even with a plain `Ingress`,
because Related never took the second hop from the Pod through its Services.

Related now understands three routing families and walks them in both
directions:

- **Ingress** — backend Services, and now also the Secrets named by
  `spec.tls[].secretName`.
- **Traefik** — `IngressRoute`, `IngressRouteTCP` and `IngressRouteUDP` to
  their Services (with the port), their `Middleware` chain and their TLS
  Secret; a `Middleware` in turn lists the routes that use it. Both the
  `traefik.io` and the older `traefik.containo.us` API group are recognised,
  and a `kind: TraefikService` reference is linked as such rather than
  mistaken for a Service.
- **Gateway API** — `HTTPRoute` to its backend Services (including a
  `RequestMirror` filter's backend) and to its parent `Gateway` with the
  listener name; a `Gateway` to its `GatewayClass`, its listener certificates
  and the routes attached to it; a `GatewayClass` to its Gateways.

A Pod now reaches all of it transitively: Related finds the Services whose
selector matches the Pod, then every router pointing at those Services, shown
as `routes to pod` with the Service it goes through.

Traefik and Gateway API both allow a route to name a Service in another
namespace, which is how a cluster that keeps all of its routing objects in one
ingress namespace is set up, so those routes are searched cluster-wide and the
link points at the route's own namespace. A built-in `Ingress` cannot cross
namespaces, so it is still searched only in the object's own namespace.

These are CRDs, so they may not exist. The Related route now reads the
cluster's `kubectl api-resources` — the same cached discovery Global Search
already uses — and asks only for the route kinds the cluster actually serves.
A cluster without Traefik or Gateway API issues no extra kubectl call and
shows no failed source in the diagnostics strip. Discovery also supplies the
namespaced/cluster-scoped flag for custom resources, so a cluster-scoped CRD
is no longer queried with a namespace. If discovery itself is unavailable,
Related degrades to exactly its previous behaviour instead of failing.

Discovery and the target object are fetched concurrently, so opening Related
on any object does not wait for a discovery round trip first.

## A Service did not show its endpoints

The Service summary had a `Ready endpoints` tile that never rendered: it read
a field the backend has never produced. Endpoints do not live on the Service
object, so the summary now fetches them.

The Summary tab of a Service shows how many endpoints are ready out of the
total, how many are not ready, and the list itself — address, ports, backing
Pod, and ready state, with the node and zone in the tooltip. A Service that
nothing backs says so, which is the case worth catching.

Endpoints are read from `EndpointSlice` (the `Endpoints` API is deprecated as
of Kubernetes 1.33) with a label selector, so the API server returns the
slices of that one Service instead of every slice in the namespace. Counts are
exact; the list is capped at 100 entries with the remainder noted. The lookup
runs only for a Service with the Summary tab open, and a cluster that refuses
it (no RBAC for endpointslices, no EndpointSlice API) leaves the rest of the
summary intact instead of replacing it with an error.

A Pod's summary also gained the node IP next to the node name.

## The drawer forgot which tab you were on

Walking through pods with the YAML tab open meant clicking YAML again for
every single pod, because the drawer always reopened on Summary.

The drawer now remembers the last tab per resource kind. Moving from pod to
pod keeps YAML open; switching to Services starts on Summary again, and coming
back to pods returns to YAML. Each kind remembers its own tab, so Secrets can
sit on Secret while pods sit on Logs. Pinned resource tabs keep their own tab
as before.

A remembered tab that the next resource does not offer falls back to Summary,
which also generalises the previous special case for the removed Events tab.

## YAML needed a click before it could be edited

The YAML tab opened in a read-only folded view, and typing required pressing
Edit first — which then replaced the folded view with a flat editor, losing
the grouping. The two modes are now one: the manifest is editable immediately,
and sections stay collapsible while you edit, the way code folding works in an
editor.

Collapsing a section replaces it with a summary row and splits the rest into
editable blocks around it, so typing in one part never disturbs a fold
somewhere else. A section that is still expanded keeps its own fold arrow next
to it. Searching forces the folds open before selecting the match, so a hit
inside a collapsed section is still reachable.

The collapse button now greys out once everything it would collapse is already
collapsed, matching the expand button, which already did.

## Fixes

- The Related tab's group headers show `IngressRoutes`, `HTTPRoutes`,
  `Middlewares` and similar CRD names in their proper camel case instead of
  the flattened `Ingressroutes`.
- The service endpoints list wraps its ports and Pod name instead of cutting
  them off with an ellipsis in a narrow drawer.
- The grouped YAML editor has a single scrollbar. Sizing a section from a line
  count multiplied by a line height put a second scrollbar inside every
  section, because a fractional line box (12px × 1.35) rounds up per line and
  the accumulated overflow re-armed the inner scroll container.
- The YAML caret sits on the character it is editing. The invisible input
  layer carried both `inset: 0` and a content-box `width: 100%`, which added
  its 62px of padding on top and pushed the caret right of the text.
- Collapsing a YAML section no longer opens a gap in the line spacing where
  the fold is.
