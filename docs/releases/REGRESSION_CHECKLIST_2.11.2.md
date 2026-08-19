# KubeDeck 2.11.2 regression checklist

Automated gates below ran and passed during development, including new tests
pinning the added behaviors (route CRD discovery and both directions of the
Traefik/Gateway API relations, cross-namespace route lookup, the service
endpoints operation, per-resource drawer tab memory, YAML edit segments).
Manual items stay open until someone runs them on a real cluster.

## Automated gates

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run test:renderer`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm --workspace apps/desktop run test:gateway`
- [x] `npm run verify:release`
- [x] `/migration/status` remains `node-only`, **Node 56 / Python 0**

## Related resources: Traefik

- [ ] On a cluster with Traefik, open a Service that an `IngressRoute` points
  at: the route appears under Related with `routes to service`.
- [ ] Open a Pod behind that Service: the same route appears with
  `routes to pod` and names the Service it goes through.
- [ ] Open the `IngressRoute` itself: it links its Services (with the port),
  its `Middleware` entries and the Secret from `spec.tls.secretName`.
- [ ] Open one of those `Middleware` objects: it lists the routes using it.
- [ ] A route whose `services[].namespace` points at another namespace is
  still found from that Service, and the link shows the route's namespace.
- [ ] `IngressRouteTCP` and `IngressRouteUDP` behave the same way.
- [ ] A route referencing a `kind: TraefikService` links to the
  `TraefikService`, not to a Service of that name.
- [ ] On a Traefik v2 cluster (`traefik.containo.us`) the same links appear.

## Related resources: Gateway API

- [ ] Open a Service that an `HTTPRoute` points at: the route appears.
- [ ] Open the `HTTPRoute`: it links its backend Services and its parent
  `Gateway`, with the listener name when `sectionName` is set.
- [ ] Open that `Gateway`: it links its `GatewayClass`, its listener
  certificate Secrets and the `HTTPRoute` objects attached to it, including
  routes from other namespaces.
- [ ] Open the `GatewayClass`: it lists the Gateways using it.
- [ ] Clicking any of these links opens the object in the drawer.

## Related resources: no routing CRDs installed

- [ ] On a cluster with neither Traefik nor Gateway API, open Related for a
  Service and a Pod: no failed source appears in the diagnostics strip, and
  the scanned list contains no CRD names.
- [ ] Built-in `Ingress` relations still work in both directions, and an
  `Ingress` now also links the Secrets from its `spec.tls`.
- [ ] Related on a Node, Secret, ConfigMap and RBAC object is unchanged.
- [ ] Open Related on a cluster-scoped CRD instance: it loads without a
  namespace error.
- [ ] On a cluster where `kubectl api-resources` fails or is slow, Related
  still returns the built-in relations.

## Service endpoints in Summary

- [ ] Open a Service with ready endpoints: Summary shows `Ready endpoints`
  as ready/total and lists the addresses with ports and backing Pods.
- [ ] Scale its Deployment to 0: the summary shows no endpoints and the
  explanatory line instead of an empty list.
- [ ] A Service with a rolling update in progress shows not-ready endpoints
  marked as such.
- [ ] Hovering an endpoint shows its node and zone.
- [ ] A Service with many endpoints shows the cap notice and an exact total.
- [ ] A headless Service and an `ExternalName` Service do not break the tab.
- [ ] Without RBAC for `endpointslices`, the rest of the Summary still
  renders and no error banner replaces it.
- [ ] Switching quickly between Services never shows another Service's
  endpoints.
- [ ] A Pod's Summary shows `Node IP` next to `Node`.

## Drawer tab memory

- [ ] Open a pod, switch to YAML, then open another pod: YAML is open.
- [ ] Switch to Services: the drawer opens on Summary; return to pods: YAML.
- [ ] Set different tabs for pods and Secrets, then alternate between them:
  each kind keeps its own.
- [ ] Leave a pod on Logs, then open a Node: the drawer falls back to Summary
  rather than a tab the Node does not have.
- [ ] Pinned resource tabs still keep the tab they were left on.
- [ ] Restart the app: the drawer opens on Summary again.

## YAML tab

- [ ] Open YAML: the manifest can be typed into immediately, with no Edit
  button to press first.
- [ ] Collapse a top-level section, then edit text above and below it: the
  fold stays collapsed and the edits land in the right place.
- [ ] Expand it again and confirm the manifest is byte-identical to before
  the fold (Reset stays disabled if nothing else was typed).
- [ ] Collapse a nested section while its parent is expanded.
- [ ] Collapse everything: the collapse button greys out; expand all: the
  expand button greys out.
- [ ] Search for text inside a collapsed section: the folds open and the
  match is selected.
- [ ] Scroll a long manifest: there is exactly one vertical scrollbar and one
  horizontal scrollbar, both belonging to the editor as a whole.
- [ ] Click into the middle of a long line: the caret lands on the character
  under the pointer.
- [ ] Line numbers stay continuous and evenly spaced across a fold boundary.
- [ ] Dry-run and apply an edit made with a section collapsed.
- [ ] A CRD definition stays read-only.
- [ ] Close the drawer with unsaved YAML: the confirmation still appears.

## Product regression

- [ ] Cluster import, switching, rename, removal and refresh work.
- [ ] Pod Terminal and Node SSH connect, resize and disconnect correctly.
- [ ] Pod Drawer logs and YAML (dry-run, apply, reset, reload) work.
- [ ] Global Search, Problems and Port Forward work.
- [ ] LLM status, preview and analysis work without receiving Kubernetes logs.
