# KubeDeck 2.20.0 regression checklist

One new section: how to reach a Service. The automated gates below ran and
passed during development, and the section was rendered against the
application's own stylesheets for a ClusterIP, a LoadBalancer with node ports,
a headless Service and an ExternalName before release.

Earlier 2.13.x through 2.19.0 checklists still apply.

## Automated gates

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run test:renderer`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm --workspace apps/desktop run test:gateway`
- [x] `npm run verify:release`
- [x] `/migration/status` remains `node-only`, **Node 58 / Python 0**

## How to reach it

- [ ] Open a ClusterIP Service (`kube-system/kube-dns`): a **How to reach it**
  section sits above Endpoints, listing Cluster DNS and ClusterIP lines.
- [ ] The DNS line reads `<name>.<namespace>.svc.cluster.local:<port>`.
- [ ] A Service with `53/UDP` and `53/TCP` shows that address **once**, with
  both port names beside it.
- [ ] A Service with several distinct ports shows one line per port.
- [ ] Click any line: the address is on the clipboard and the drawer says so.
- [ ] The `kubectl port-forward` line copies too, and the command it copies
  works when pasted into a terminal.

## The other Service types

- [ ] A **LoadBalancer**: the external address appears, per port, alongside the
  cluster ones, and NodePort lines read `<node-ip>:<nodePort>`.
- [ ] A **NodePort** Service without a load balancer: the NodePort lines are
  there and there is no External line.
- [ ] A **headless** Service (`clusterIP: None`): there is no ClusterIP line,
  and a Headless line explains that the name resolves to the pod addresses.
- [ ] An **ExternalName**: exactly one line, the name the cluster answers with,
  and no DNS, ClusterIP or port-forward lines.
- [ ] A Service with no ports at all: the DNS name is shown with a note, and
  nothing crashes.

## Schemes

- [ ] A port named `http` or on 80/8080 shows `http://…`.
- [ ] A port named `https`, one with `appProtocol: https`, or one on 443/8443
  shows `https://…`.
- [ ] A database or other unnamed port shows `host:port` with **no** scheme.
- [ ] A UDP port never gets a scheme.

## Nothing else moved

- [ ] The Service Summary's tiles - Status, Age, Type, Cluster IP, Ports,
  Selector, Ready endpoints - are unchanged.
- [ ] The Endpoints block below still lists the endpoint addresses and their
  pods.
- [ ] The Services table still shows its Ports column as before.
- [ ] The port-forward button in the drawer header still opens its dialog and
  starts a forward, and the Port forwards panel still links to it.
- [ ] Open a Pod, a Node and a ConfigMap: none of them shows the section.
- [ ] Switch themes, light included: the section repaints with everything else.
- [ ] Connect and disconnect a cluster, and run an LLM analysis on a pod: both
  behave as in 2.19.0.
- [ ] Help and About report **2.20.0**.
