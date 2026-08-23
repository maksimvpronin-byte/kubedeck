# KubeDeck 2.20.0 release notes

A Service's Summary says how to reach it. Working that out used to mean reading
the type, the ClusterIP and the port list and assembling the address in your
head.

No route changes. Node-only ownership stays at Node 58 / Python 0.

## What the section shows

A **How to reach it** block, one line per address, each line a button that
copies it:

- **Cluster DNS** — `kube-dns.kube-system.svc.cluster.local:53`, one line per
  port.
- **ClusterIP** — `10.43.0.10:53`.
- **Headless** — for `clusterIP: None`, the name with a note that it resolves
  to the pod addresses rather than to one address.
- **NodePort** — `<node-ip>:31080`, on any node of the cluster.
- **External** — each load balancer address and each `externalIP`, per port.
- **ExternalName** — the name the cluster answers with, and nothing else, since
  nothing else applies.
- **From here** — `kubectl port-forward -n kube-system svc/kube-dns 53:53`,
  which is what actually reaches the Service from the machine KubeDeck runs on.
  The port-forward button in the drawer header does the same thing.

## Two things it is careful about

**A scheme is only written where the port says what it speaks** - by its name,
by `appProtocol`, or by being one of the numbers everybody uses for HTTP. A
port named `http` becomes `http://web.shop.svc.cluster.local:80`; a port named
`pg` stays `postgres.data.svc.cluster.local:5432`, because `http://` in front
of a database port is an address that cannot work.

**Nothing here is a link.** A ClusterIP is not routable from your machine and
`svc.cluster.local` does not resolve on it, so a clickable link would be a
promise the application cannot keep - and KubeDeck only ever opens `localhost`
URLs anyway. Every line copies instead. The one address that is genuinely
openable, a running port-forward's `http://127.0.0.1:…`, is a link where it
already was: in the Port forwards panel.

An address that two ports share - `53/UDP` and `53/TCP` are the usual pair - is
printed once, with both ports named beside it.

## Under the hood

The gateway sent a Service's ports only as the string a table cell prints,
`http · 80 → 8080/TCP`, which no address can be built from. The pieces travel
now too, along with the load balancer addresses, the external IPs and the
external name.
