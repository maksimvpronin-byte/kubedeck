const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const {
  buildSearchResourceSpecs,
  deduplicateSearchResults,
  parseApiResources,
  rankRawItems,
  scoreSearchResult,
} = require("../dist/main/backend/search/searchEngine.js");
const {
  buildSearchResponse,
  handleSearchRequest,
  matchSearchRoute,
} = require("../dist/main/backend/routes/search.js");
const {
  ClusterNotFoundError,
} = require("../dist/main/backend/config/configStore.js");
const { KubectlError } = require("../dist/main/backend/kubectl/errors.js");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function fakeConfigStore() {
  return {
    load() {
      return {
        settings: { kubectlPath: "kubectl" },
        clusters: [
          { id: "cluster-1", kubeconfigPath: "C:\\temp\\cluster-1.yaml" },
        ],
      };
    },
    getCluster(clusterId, config = this.load()) {
      const cluster = config.clusters.find((item) => item.id === clusterId);
      if (!cluster) throw new ClusterNotFoundError(clusterId);
      return cluster;
    },
  };
}

function apiResourcesOutput() {
  return [
    "NAME SHORTNAMES APIVERSION NAMESPACED KIND VERBS",
    "pods po v1 true Pod [get list watch]",
    "deployments deploy apps/v1 true Deployment [get list watch]",
    "widgets wd widgets.example.com/v1 true Widget [get list watch]",
    "clusterwidgets cw widgets.example.com/v1 false ClusterWidget [get list watch]",
  ].join("\n");
}

function rawForResource(resource) {
  const baseMetadata = {
    uid: `${resource}-uid`,
    name: resource === "pods" ? "api-server" : `${resource}-item`,
    namespace: "default",
    creationTimestamp: "2026-06-22T10:00:00Z",
    labels: { app: "api", team: "platform" },
    annotations: { owner: "sre" },
  };
  if (resource === "pods") {
    return {
      items: [
        {
          apiVersion: "v1",
          kind: "Pod",
          metadata: baseMetadata,
          spec: { nodeName: "worker-1", containers: [{ name: "api" }] },
          status: { phase: "Running", podIP: "10.0.0.10" },
        },
      ],
    };
  }
  if (resource === "deployments") {
    return {
      items: [
        {
          apiVersion: "apps/v1",
          kind: "Deployment",
          metadata: baseMetadata,
          spec: { replicas: 2 },
          status: { readyReplicas: 2, availableReplicas: 2 },
        },
      ],
    };
  }
  if (resource === "customresourcedefinitions") {
    return {
      items: [
        {
          apiVersion: "apiextensions.k8s.io/v1",
          kind: "CustomResourceDefinition",
          metadata: {
            uid: "crd-widget",
            name: "widgets.widgets.example.com",
            creationTimestamp: "2026-06-22T08:00:00Z",
          },
          spec: {
            group: "widgets.example.com",
            scope: "Namespaced",
            names: { plural: "widgets", kind: "Widget" },
          },
        },
      ],
    };
  }
  if (resource === "widgets.widgets.example.com") {
    return {
      items: [
        {
          apiVersion: "widgets.example.com/v1",
          kind: "Widget",
          metadata: {
            uid: "widget-1",
            name: "widget-blue",
            namespace: "default",
            labels: { app: "widget" },
          },
          spec: { type: "blue" },
          status: { phase: "Ready" },
        },
      ],
    };
  }
  return { items: [] };
}

test("search scoring prefers exact names and requires every token", () => {
  const raw = {
    kind: "Pod",
    metadata: {
      name: "api-server",
      namespace: "default",
      labels: { app: "api", team: "platform" },
    },
    status: { phase: "Running" },
  };
  const exact = scoreSearchResult("api-server", "pods", raw, {
    name: "api-server",
    namespace: "default",
    kind: "Pod",
  });
  const label = scoreSearchResult("api platform", "pods", raw, {
    name: "api-server",
    namespace: "default",
    kind: "Pod",
  });
  const missing = scoreSearchResult("api missing", "pods", raw, {
    name: "api-server",
    namespace: "default",
    kind: "Pod",
  });
  assert.ok(exact.score > label.score);
  assert.ok(exact.matchedFields.includes("name"));
  assert.ok(label.matchedFields.includes("labels"));
  assert.equal(missing.score, 0);
});

test("api discovery adds matching CRD definitions and instances", () => {
  const definitions = parseApiResources(apiResourcesOutput());
  assert.equal(definitions.find((item) => item.kind === "Deployment").apiGroup, "apps");
  assert.equal(definitions.find((item) => item.kind === "Pod").apiGroup, "");
  const specs = buildSearchResourceSpecs("widget", true, definitions);
  assert.ok(specs.some((item) => item.resource === "customresourcedefinitions"));
  assert.ok(specs.some((item) => item.resource === "widgets.widgets.example.com"));
  assert.ok(specs.some((item) => item.resource === "clusterwidgets.widgets.example.com"));
  const disabled = buildSearchResourceSpecs("widget", false, definitions);
  assert.equal(disabled.some((item) => item.crdInstance), false);
});

test("ranking and deduplication keep the highest scoring resource row", () => {
  const spec = {
    resource: "pods",
    kind: "Pod",
    scope: "namespaced",
    normalizer: "resource",
  };
  const ranked = rankRawItems(spec, rawForResource("pods").items, "api", 10);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].name, "api-server");
  assert.equal(ranked[0].namespace, "default");
  assert.equal(ranked[0].source, "global-search");
  const lower = { ...ranked[0], score: 1 };
  const deduplicated = deduplicateSearchResults([lower, ranked[0]]);
  assert.equal(deduplicated.length, 1);
  assert.equal(deduplicated[0].score, ranked[0].score);
});

test("Global Search runs sources concurrently and preserves partial errors", async (t) => {
  const commands = [];
  let active = 0;
  let maximumActive = 0;
  const runner = {
    async run(command) {
      commands.push(command.args);
      return {
        ok: true,
        stdout: apiResourcesOutput(),
        stderr: "",
        commandPreview: "kubectl api-resources",
        returnCode: 0,
      };
    },
    async runJson(command) {
      commands.push(command.args);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      const resource = command.args[1];
      if (resource === "services") {
        throw new KubectlError({
          code: "FORBIDDEN",
          message: "kubectl command failed",
          rawStderr: "forbidden",
          commandPreview: "kubectl get services -A -o json",
        });
      }
      return rawForResource(resource);
    },
  };
  const body = await buildSearchResponse(
    fakeConfigStore(),
    runner,
    "cluster-1",
    {
      query: "api",
      namespaces: ["all"],
      limit: 50,
      includeCrdInstances: true,
    },
    () => {},
    () => new Date("2026-06-22T12:00:00Z"),
  );
  assert.ok(maximumActive > 1);
  assert.equal(body.summary.query, "api");
  assert.equal(body.summary.generatedAt, "2026-06-22T12:00:00.000Z");
  assert.equal(body.errors.length, 1);
  assert.equal(body.errors[0].resource, "services");
  assert.ok(body.items.some((item) => item.name === "api-server"));
  assert.ok(commands.some((args) => args.includes("-A")));

  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    const handled = handleSearchRequest(
      request,
      response,
      pathname,
      fakeConfigStore(),
      runner,
      () => {},
    );
    if (!handled) {
      response.statusCode = 404;
      response.end();
    }
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));
  const response = await fetch(
    `${baseUrl}/clusters/cluster-1/search?q=api&namespace=all&limit=20&includeCrdInstances=false`,
  );
  assert.equal(response.status, 200);
  const responseBody = await response.json();
  assert.equal(responseBody.summary.query, "api");
  assert.ok(Array.isArray(responseBody.items));
});

test("Global Search supports namespace lists and cluster-only mode", async () => {
  const commands = [];
  const runner = {
    async run() {
      return {
        ok: true,
        stdout: apiResourcesOutput(),
        stderr: "",
        commandPreview: "kubectl api-resources",
        returnCode: 0,
      };
    },
    async runJson(command) {
      commands.push(command.args);
      return { items: [] };
    },
  };
  await buildSearchResponse(fakeConfigStore(), runner, "cluster-1", {
    query: "worker",
    namespaces: ["team-a", "team-b"],
    limit: 10,
    includeCrdInstances: false,
  });
  assert.ok(commands.some((args) => args.includes("team-a")));
  assert.ok(commands.some((args) => args.includes("team-b")));
  assert.ok(commands.some((args) => args[1] === "nodes" && !args.includes("-n")));
});

test("Global Search validates query, limit, route, and missing cluster", async (t) => {
  assert.equal(matchSearchRoute("POST", "/clusters/cluster-1/search"), null);
  assert.equal(matchSearchRoute("GET", "/clusters/cluster-1/search").clusterId, "cluster-1");
  let calls = 0;
  const runner = {
    async run() {
      calls += 1;
      return { stdout: apiResourcesOutput() };
    },
    async runJson() {
      calls += 1;
      return { items: [] };
    },
  };
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    handleSearchRequest(
      request,
      response,
      pathname,
      fakeConfigStore(),
      runner,
      () => {},
    );
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));

  const tooShort = await fetch(`${baseUrl}/clusters/cluster-1/search?q=a`);
  assert.equal(tooShort.status, 400);
  assert.equal((await tooShort.json()).detail.code, "SEARCH_QUERY_TOO_SHORT");

  const badLimit = await fetch(`${baseUrl}/clusters/cluster-1/search?q=api&limit=501`);
  assert.equal(badLimit.status, 400);
  assert.equal((await badLimit.json()).detail.code, "INVALID_SEARCH_LIMIT");

  const missing = await fetch(`${baseUrl}/clusters/missing/search?q=api`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).detail.code, "CLUSTER_NOT_FOUND");
  assert.equal(calls, 0);
});

test("Global Search returns a partial response on total timeout", async () => {
  let aborted = false;
  const runner = {
    async run() {
      return {
        ok: true,
        stdout: "NAME SHORTNAMES APIVERSION NAMESPACED KIND VERBS\n",
        stderr: "",
        commandPreview: "kubectl api-resources",
        returnCode: 0,
      };
    },
    async runJson(_command, signal) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 50);
        signal.addEventListener("abort", () => {
          aborted = true;
          clearTimeout(timer);
          reject(new Error("cancelled"));
        }, { once: true });
      });
      return { items: [] };
    },
  };
  const body = await buildSearchResponse(
    fakeConfigStore(),
    runner,
    "cluster-1",
    {
      query: "api",
      namespaces: ["all"],
      limit: 10,
      includeCrdInstances: false,
    },
    () => {},
    () => new Date("2026-06-22T12:00:00Z"),
    { totalTimeoutSeconds: 0.01, concurrency: 1 },
  );
  assert.ok(body.errors.some((error) => error.code === "SEARCH_TIMEOUT"));
  assert.equal(body.summary.errors, 1);
  assert.equal(aborted, true);
});
