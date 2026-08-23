// What a single resource shows: node metadata, Service addresses, CronJob run.
// Split out of renderer-controllers.contract.test.cjs; see
// docs/file-structure-refactor-plan.md, section C.
// A test marked `grep contract` reads a source file and asserts on its text.
// It breaks on a rename and passes through a real regression, so it is a
// placeholder for a behavioural test rather than one. See section C of
// docs/file-structure-refactor-plan.md.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadTypeScript, rendererRoot } = require("./helpers/renderer.cjs");

test("node labels and annotations are read whole, not guessed at from three chips", () => {
  const metadata = loadTypeScript("utils/metadataEntries.ts");
  const placement = loadTypeScript("utils/popoverPlacement.ts");
  const cell = fs.readFileSync(path.join(rendererRoot, "components/NodeLabelsCell.tsx"), "utf8");
  const section = fs.readFileSync(path.join(rendererRoot, "components/NodeMetadataSection.tsx"), "utf8");
  const columns = loadTypeScript("utils/resourceTableColumns.ts");
  const table = fs.readFileSync(path.join(rendererRoot, "components/ResourceTable.tsx"), "utf8");
  const menu = fs.readFileSync(path.join(rendererRoot, "components/ResourceTableColumnsMenu.tsx"), "utf8");

  // Roles are a column now, where kubectl puts them.
  const nodeColumns = columns.buildResourceTableColumns((key) => key).nodes.map((column) => column.key);
  assert.ok(nodeColumns.includes("roles"));
  assert.ok(nodeColumns.indexOf("roles") < nodeColumns.indexOf("labelsText"));
  assert.match(table, /if \(key === "roles" && row\.roles !== undefined\) return <NodeRolesCell row=\{row\} \/>;/);

  // The remainder is a popover rendered into the body, not a native tooltip
  // holding a comma-joined blob, and it is placed by the same helper the
  // columns menu uses.
  assert.doesNotMatch(cell, /title=\{full\}|aria-label=\{full/);
  assert.match(cell, /createPortal\(/);
  assert.match(cell, /useAnchoredPopover\(POPOVER_WIDTH, POPOVER_HEIGHT\)/);
  assert.match(menu, /useAnchoredPopover\(POPOVER_WIDTH, POPOVER_HEIGHT\)/);
  assert.doesNotMatch(menu, /function placePopover/);

  // Clicking a label filters the list by it, and must not open the row beneath.
  assert.match(table, /formatCell\(row, column\.key, setQuery\)/);
  assert.match(cell, /onFilter\?\.\(labelText\(label\)\)/);
  assert.match(cell, /event\.stopPropagation\(\);\s*filterBy\(label\)/);

  globalThis.window = { innerHeight: 800, innerWidth: 1280 };
  try {
    const upward = placement.placeAnchoredPopover({ getBoundingClientRect: () => ({ top: 700, bottom: 720, right: 400 }) }, 240, 360);
    assert.ok(upward.top < 700, "a trigger near the bottom opens upwards");
    const clamped = placement.placeAnchoredPopover({ getBoundingClientRect: () => ({ top: 10, bottom: 30, right: 5 }) }, 240, 360);
    assert.equal(clamped.left, 12, "a popover never leaves the window on the left");
  } finally {
    globalThis.window = undefined;
  }

  // Grouping needs no curated list of interesting keys: the domain in front of
  // the slash says who wrote the entry, and what Kubernetes wrote on every node
  // sorts after what somebody here chose.
  const groups = metadata.groupMetadataEntries([
    { key: "kubernetes.io/os", value: "linux" },
    { key: "example.com/team", value: "platform" },
    { key: "gpu", value: "none" },
    { key: "node.kubernetes.io/instance-type", value: "k3s" },
  ]);
  assert.deepEqual(
    groups.map((group) => group.prefix),
    ["", "example.com", "kubernetes.io", "node.kubernetes.io"],
  );
  assert.deepEqual(
    groups.map((group) => group.wellKnown),
    [false, false, true, true],
  );
  assert.equal(metadata.isWellKnownKey("csi.storage.k8s.io/nodeid"), true);
  assert.equal(metadata.isWellKnownKey("flannel.alpha.coreos.com/backend-type"), false);
  assert.equal(metadata.isWellKnownKey("team"), false);

  // The section shows both, and a value long enough to be a document of its own
  // is held back behind More rather than pushing everything off the screen.
  assert.match(section, /title="Labels"/);
  assert.match(section, /title="Annotations"/);
  assert.match(section, /entry\.value\.length > LONG_VALUE_LENGTH/);
  assert.match(section, /nodeAnnotationItems/);
});

test("nodes sort by one chosen annotation, not by all of them at once", () => {
  const sort = loadTypeScript("utils/annotationSort.ts");
  const state = loadTypeScript("hooks/useResourceTableState.ts");
  const metrics = loadTypeScript("utils/resourceTableSortMetrics.ts");
  const columns = loadTypeScript("utils/resourceTableColumns.ts");
  const table = fs.readFileSync(path.join(rendererRoot, "components/ResourceTable.tsx"), "utf8");

  const node = (name, annotations) => ({ name, nodeAnnotationItems: Object.entries(annotations).map(([key, value]) => ({ key, value })) });
  const rows = [
    node("openclaw", { "alpha.kubernetes.io/provided-node-ip": "192.168.1.10", "node.alpha.kubernetes.io/ttl": "30" }),
    node("worker-a", { "alpha.kubernetes.io/provided-node-ip": "192.168.1.11", "node.alpha.kubernetes.io/ttl": "5" }),
    node("worker-b", { "alpha.kubernetes.io/provided-node-ip": "192.168.1.12" }),
  ];

  // Sorting by "annotations" would sort by whichever key comes first in the
  // alphabet, which is the same on every node and orders nothing. The header
  // offers the keys the loaded rows carry, the ones on most nodes first.
  assert.deepEqual(
    sort.annotationSortMetrics(rows).map((metric) => metric.label),
    ["alpha.kubernetes.io/provided-node-ip", "node.alpha.kubernetes.io/ttl"],
  );
  assert.equal(sort.annotationSortMetrics(rows)[0].key, "annotation:alpha.kubernetes.io/provided-node-ip");
  assert.deepEqual(sort.annotationSortMetrics([]), []);

  const ttl = sort.annotationSortKey("node.alpha.kubernetes.io/ttl");
  const sorted = [...rows].sort((left, right) => state.compareRows(left, right, ttl));
  // 5 before 30, because the collator counts rather than spells; and the node
  // that has no such annotation sits at the low end, so descending puts it last.
  assert.deepEqual(
    sorted.map((row) => row.name),
    ["worker-b", "worker-a", "openclaw"],
  );
  assert.equal(state.compareRows(rows[2], rows[2], ttl), 0);

  // The keys cannot be listed ahead of time, so the column claims its sort by
  // the prefix and keeps its header marked.
  assert.equal(metrics.sortKeyBelongsToColumn("nodeAnnotations", ttl), true);
  assert.equal(metrics.sortKeyBelongsToColumn("labelsText", ttl), false);
  assert.match(table, /const annotationMetrics = useMemo\(\(\) => annotationSortMetrics\(rows\), \[rows\]\);/);
  assert.match(table, /metricsFor\(column\.key\)\.length \? \(/);

  // The column is in the menu and out of the table until somebody asks for it,
  // because most annotations are written by the CNI for itself.
  const nodeColumns = columns.buildResourceTableColumns((key) => key).nodes;
  const annotationColumn = nodeColumns.find((column) => column.key === "nodeAnnotations");
  assert.ok(annotationColumn, "nodes offer an Annotations column");
  assert.equal(annotationColumn.defaultHidden, true);
  assert.deepEqual(state.defaultHiddenColumns(nodeColumns), ["nodeAnnotations"]);
  assert.deepEqual(state.defaultHiddenColumns([{ key: "name", label: "Name" }]), []);
  const stateSource = fs.readFileSync(path.join(rendererRoot, "hooks/useResourceTableState.ts"), "utf8");
  assert.match(stateSource, /loadUiState\(\)\.hiddenColumns\?\.\[stateKey\] \?\? defaultHiddenColumns\(columns\)/);
  assert.match(stateSource, /setHiddenColumns\(defaultHiddenColumns\(columns\)\);/);
  // Searching the table reaches annotations through the text the gateway
  // prepared, the way it already reaches labels.
  assert.match(stateSource, /column\.key === "nodeAnnotations"\s*\?\s*String\(row\.nodeAnnotationsSearch \?\? ""\)/);
});

test("a Service says how to reach it, in addresses to copy rather than links to follow", () => {
  const addresses = loadTypeScript("utils/serviceAddresses.ts");
  const section = fs.readFileSync(path.join(rendererRoot, "components/ServiceAddressesSection.tsx"), "utf8");
  const summary = fs.readFileSync(path.join(rendererRoot, "components/ResourceSummary.tsx"), "utf8");
  const port = (extra) => ({ name: "", port: 0, targetPort: "", nodePort: 0, protocol: "TCP", appProtocol: "", ...extra });

  const clusterIp = {
    name: "kube-dns",
    namespace: "kube-system",
    type: "ClusterIP",
    clusterIp: "10.43.0.10",
    servicePortItems: [port({ name: "dns", port: 53, protocol: "UDP" }), port({ name: "dns-tcp", port: 53 }), port({ name: "metrics", port: 9153 })],
  };
  // 53/UDP and 53/TCP are one address twice, and printing it twice reads as a
  // mistake; the ports that produced it are named beside it instead.
  assert.deepEqual(
    addresses.serviceAddresses(clusterIp).map((entry) => `${entry.group} ${entry.address}`),
    ["Cluster DNS kube-dns.kube-system.svc.cluster.local:53", "Cluster DNS kube-dns.kube-system.svc.cluster.local:9153", "ClusterIP 10.43.0.10:53", "ClusterIP 10.43.0.10:9153"],
  );
  assert.equal(addresses.serviceAddresses(clusterIp)[0].hint, "dns · UDP, dns-tcp · TCP");
  assert.equal(addresses.portForwardCommand(clusterIp), "kubectl port-forward -n kube-system svc/kube-dns 53:53");

  // A scheme is written only where the port says what it speaks: guessing
  // http:// onto a database port would produce an address that cannot work.
  assert.equal(addresses.portScheme(port({ name: "http", port: 8080 })), "http");
  assert.equal(addresses.portScheme(port({ appProtocol: "https", port: 8443 })), "https");
  assert.equal(addresses.portScheme(port({ port: 443 })), "https");
  assert.equal(addresses.portScheme(port({ name: "pg", port: 5432 })), "");
  assert.equal(addresses.portScheme(port({ name: "dns", port: 53, protocol: "UDP" })), "");

  const loadBalancer = {
    name: "web",
    namespace: "shop",
    type: "LoadBalancer",
    clusterIp: "10.43.7.21",
    servicePortItems: [port({ name: "http", port: 80, nodePort: 31080 })],
    loadBalancerAddresses: ["203.0.113.4"],
  };
  assert.deepEqual(
    addresses.serviceAddresses(loadBalancer).map((entry) => entry.address),
    ["http://web.shop.svc.cluster.local:80", "http://10.43.7.21:80", "<node-ip>:31080", "http://203.0.113.4:80"],
  );

  // A headless Service has no address of its own; the name answers with the
  // pod addresses behind it.
  const headless = { name: "postgres", namespace: "data", clusterIp: "None", servicePortItems: [port({ name: "pg", port: 5432 })] };
  const headlessAddresses = addresses.serviceAddresses(headless);
  assert.deepEqual(
    headlessAddresses.map((entry) => entry.group),
    ["Cluster DNS", "Headless"],
  );
  assert.match(headlessAddresses[1].hint, /pod addresses/);

  // An ExternalName is a CNAME and nothing else applies to it.
  assert.deepEqual(addresses.serviceAddresses({ name: "vendor", namespace: "shop", type: "ExternalName", externalName: "api.vendor.example.com" }), [
    { group: "ExternalName", address: "api.vendor.example.com", hint: "the cluster resolves this Service to this name" },
  ]);
  assert.deepEqual(addresses.serviceAddresses({ name: "vendor", namespace: "shop", type: "ExternalName" }), []);

  // Every row copies. None of them is a link: a ClusterIP is not routable from
  // this machine, and the application only opens localhost URLs anyway.
  assert.match(section, /className="service-address-value"/);
  assert.doesNotMatch(section, /<a href|target="_blank"/);
  assert.match(section, /onClick=\{\(\) => copy\(address\.address\)\}/);
  assert.match(summary, /isService\(resource\) \? <ServiceAddressesSection row=\{row\} onCopy=\{onCopy\} \/> : null/);
});

// grep contract: asserts on source text, not behaviour.
test("the service summary renders endpoints loaded outside the Service object", () => {
  const lifecycle = fs.readFileSync(path.join(rendererRoot, "hooks/usePodDrawerResourceLifecycle.ts"), "utf8");
  const endpointsEffect = lifecycle.slice(lifecycle.indexOf("isServiceResource(resource)"), lifecycle.indexOf('tab !== "related"'));
  assert.match(endpointsEffect, /api\s*\.serviceEndpoints\(clusterId, resource, podNamespace, podName, controller\.signal\)/);
  assert.match(endpointsEffect, /requestGeneration === endpointsRequestRef\.current/, "a stale response must not land on another object");
  assert.match(endpointsEffect, /\.catch\(\(\) => undefined\)/, "a refused endpoint lookup must not replace the summary with an error");
  assert.match(lifecycle, /serviceEndpoints: snapshotIsCurrent \? serviceEndpoints : null/);

  const tabBody = fs.readFileSync(path.join(rendererRoot, "components/PodDrawerTabBody.tsx"), "utf8");
  assert.match(tabBody, /<ResourceSummary[\s\S]*?serviceEndpoints=\{serviceEndpoints\}/);

  const summary = fs.readFileSync(path.join(rendererRoot, "components/ResourceSummary.tsx"), "utf8");
  assert.match(summary, /addFact\(facts, "Ready endpoints", `\$\{serviceEndpoints\.ready\} \/ \$\{serviceEndpoints\.total\}`/);
  assert.match(summary, /\{serviceEndpoints \? <ServiceEndpoints data=\{serviceEndpoints\} \/> : null\}/);
  assert.match(summary, /No endpoints back this service/);
  assert.match(summary, /\+\{data\.total - data\.items\.length\} more endpoints not listed/);

  const styles = fs.readFileSync(path.join(rendererRoot, "styles/resource-summary.css"), "utf8");
  assert.match(styles, /\.summary-endpoint-main \{/);
  assert.match(styles, /\.summary-endpoint-detail \{/);
});

test("a CronJob can be run by hand, under a name the confirmation showed", () => {
  const names = loadTypeScript("utils/manualJobName.ts");
  const modals = loadTypeScript("components/PodDrawerModals.tsx");
  const drawer = fs.readFileSync(path.join(rendererRoot, "components/PodDrawer.tsx"), "utf8");
  const chrome = fs.readFileSync(path.join(rendererRoot, "components/PodDrawerChrome.tsx"), "utf8");
  const api = fs.readFileSync(path.join(rendererRoot, "api.ts"), "utf8");

  // Kubernetes takes a DNS-1123 label of at most 63 characters for a Job, and
  // the second the run was asked for keeps two runs from colliding.
  assert.equal(names.manualJobName("nightly", 1_750_000_000_000), "nightly-manual-1750000000");
  assert.equal(names.manualJobName("Nightly", 1_750_000_000_000), "nightly-manual-1750000000");
  const long = names.manualJobName("a".repeat(80), 1_750_000_000_000);
  assert.equal(long.length, 63);
  assert.match(long, /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/);
  // Truncating in the middle of a name can leave a dash against the suffix.
  assert.equal(names.manualJobName(`${"a".repeat(44)}--`, 1_750_000_000_000), `${"a".repeat(44)}-manual-1750000000`);
  assert.match(names.manualJobName("", 1_750_000_000_000), /^cronjob-manual-/);

  // The button lives beside Delete in the drawer, and only for CronJobs.
  assert.deepEqual(modals.supportedActions("cronjobs"), ["trigger", "delete"]);
  assert.deepEqual(modals.supportedActions("jobs"), ["delete"]);
  assert.equal(modals.actionLabel("trigger", "cronjobs"), "Run now");
  assert.match(chrome, /if \(action === "trigger"\) return <Play size=\{18\}/);

  // The name is fixed at the press rather than recomputed while the
  // confirmation is open, so the preview cannot name one Job and the request
  // create another.
  assert.match(drawer, /if \(action === "trigger"\) setTriggerJobName\(manualJobName\(pod\.name, Date\.now\(\)\)\);/);
  assert.match(drawer, /jobName=\{triggerJobName\}/);
  assert.match(drawer, /\.\.\.\(action === "trigger" \? \{ jobName: triggerJobName \} : \{\}\)/);
  assert.match(api, /body: JSON\.stringify\(\{ action, replicas, jobName, confirmation \}\)/);
});
