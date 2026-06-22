const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const {
  buildRelatedResources,
  deduplicateRelatedLinks,
  relatedLink,
  selectorMatches,
} = require("../dist/main/backend/relations/relatedResourcesEngine.js");
const {
  buildRelatedResourcesResponse,
  handleRelatedResourcesRequest,
  matchRelatedResourcesRoute,
} = require("../dist/main/backend/routes/relatedResources.js");
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

function podTarget() {
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      uid: "pod-1",
      name: "api-0",
      namespace: "default",
      labels: { app: "api", tier: "backend" },
      ownerReferences: [{ kind: "ReplicaSet", name: "api-abc" }],
    },
    spec: {
      nodeName: "worker-1",
      serviceAccountName: "api-sa",
      imagePullSecrets: [{ name: "registry-auth" }],
      volumes: [
        { name: "config", configMap: { name: "api-config" } },
        { name: "secret", secret: { secretName: "api-secret" } },
        { name: "data", persistentVolumeClaim: { claimName: "api-data" } },
      ],
      containers: [
        {
          name: "api",
          envFrom: [{ configMapRef: { name: "api-env" } }],
          env: [
            {
              name: "PASSWORD",
              valueFrom: {
                secretKeyRef: { name: "db-secret", key: "password" },
              },
            },
          ],
        },
      ],
    },
  };
}

function fixtureItems(resource) {
  const values = {
    services: [
      {
        metadata: { name: "api", namespace: "default" },
        spec: { selector: { app: "api" } },
      },
    ],
    replicasets: [
      {
        metadata: {
          name: "api-abc",
          namespace: "default",
          ownerReferences: [{ kind: "Deployment", name: "api" }],
        },
      },
    ],
    jobs: [],
    pods: [
      {
        metadata: {
          name: "api-0",
          namespace: "default",
          labels: { app: "api", tier: "backend" },
        },
        spec: {
          nodeName: "worker-1",
          serviceAccountName: "api-sa",
          volumes: [
            { persistentVolumeClaim: { claimName: "api-data" } },
            { configMap: { name: "api-config" } },
          ],
        },
      },
    ],
    ingresses: [
      {
        metadata: { name: "api-ingress", namespace: "default" },
        spec: {
          rules: [
            {
              http: {
                paths: [
                  { backend: { service: { name: "api", port: { number: 80 } } } },
                ],
              },
            },
          ],
        },
      },
    ],
    endpoints: [
      {
        metadata: { name: "api", namespace: "default" },
        subsets: [
          {
            addresses: [
              {
                ip: "10.0.0.10",
                targetRef: { kind: "Pod", name: "api-0", namespace: "default" },
              },
            ],
          },
        ],
      },
    ],
    endpointslices: [
      {
        metadata: {
          name: "api-xyz",
          namespace: "default",
          labels: { "kubernetes.io/service-name": "api" },
        },
        endpoints: [
          {
            addresses: ["10.0.0.10"],
            targetRef: { kind: "Pod", name: "api-0", namespace: "default" },
          },
        ],
        ports: [{ port: 8080 }],
      },
    ],
    rolebindings: [
      {
        metadata: { name: "api-edit", namespace: "default" },
        roleRef: { kind: "Role", name: "edit" },
        subjects: [{ kind: "ServiceAccount", name: "api-sa", namespace: "default" }],
      },
    ],
    clusterrolebindings: [
      {
        metadata: { name: "api-view" },
        roleRef: { kind: "ClusterRole", name: "view" },
        subjects: [{ kind: "ServiceAccount", name: "api-sa", namespace: "default" }],
      },
    ],
  };
  return values[resource] || [];
}

test("pod relations preserve workload, selector and config references", async () => {
  const calls = [];
  const result = await buildRelatedResources({
    resource: "pods",
    namespace: "default",
    targetRaw: podTarget(),
    async loadItems(resource, namespace) {
      calls.push(`${resource}:${namespace}`);
      return fixtureItems(resource);
    },
  });

  const keys = new Set(result.items.map((item) => `${item.resource}/${item.name}/${item.relation}`));
  assert.ok(keys.has("nodes/worker-1/scheduled on"));
  assert.ok(keys.has("serviceaccounts/api-sa/used by pod"));
  assert.ok(keys.has("deployments/api/controls pod via ReplicaSet"));
  assert.ok(keys.has("services/api/selects this pod"));
  assert.ok(keys.has("configmaps/api-config/mounted config"));
  assert.ok(keys.has("configmaps/api-env/envFrom config"));
  assert.ok(keys.has("secrets/api-secret/mounted secret"));
  assert.ok(keys.has("secrets/db-secret/env key secret"));
  assert.ok(keys.has("persistentvolumeclaims/api-data/mounted volume"));
  assert.equal(result.errors.length, 0);
  assert.equal(result.sources.services, 1);
  assert.equal(calls.filter((item) => item === "replicasets:default").length, 1);
});

test("service relations include pods, ingress, endpoints and EndpointSlices", async () => {
  const result = await buildRelatedResources({
    resource: "services",
    namespace: "default",
    targetRaw: {
      kind: "Service",
      metadata: { name: "api", namespace: "default" },
      spec: { selector: { app: "api" } },
    },
    async loadItems(resource) {
      return fixtureItems(resource);
    },
  });

  assert.ok(result.items.some((item) => item.resource === "pods" && item.name === "api-0"));
  assert.ok(result.items.some((item) => item.resource === "ingresses" && item.name === "api-ingress"));
  assert.ok(result.items.some((item) => item.resource === "endpoints" && item.name === "api"));
  const slice = result.items.find((item) => item.resource === "endpointslices");
  assert.equal(slice.name, "api-xyz");
  assert.equal(slice.detail, "1 endpoints, 1 ports");
});

test("PVC, ConfigMap, ServiceAccount and RBAC relations are retained", async () => {
  const loader = async (resource) => fixtureItems(resource);
  const pvc = await buildRelatedResources({
    resource: "persistentvolumeclaims",
    namespace: "default",
    targetRaw: {
      metadata: { name: "api-data", namespace: "default" },
      spec: { volumeName: "pv-api", storageClassName: "fast" },
    },
    loadItems: loader,
  });
  assert.ok(pvc.items.some((item) => item.resource === "persistentvolumes" && item.name === "pv-api"));
  assert.ok(pvc.items.some((item) => item.resource === "storageclasses" && item.name === "fast"));
  assert.ok(pvc.items.some((item) => item.resource === "pods" && item.name === "api-0"));

  const configMap = await buildRelatedResources({
    resource: "configmaps",
    namespace: "default",
    targetRaw: { metadata: { name: "api-config", namespace: "default" } },
    loadItems: loader,
  });
  assert.ok(configMap.items.some((item) => item.relation === "mounted by pod"));

  const account = await buildRelatedResources({
    resource: "serviceaccounts",
    namespace: "default",
    targetRaw: {
      metadata: { name: "api-sa", namespace: "default" },
      secrets: [{ name: "api-token" }],
    },
    loadItems: loader,
  });
  assert.ok(account.items.some((item) => item.resource === "rolebindings"));
  assert.ok(account.items.some((item) => item.resource === "clusterrolebindings"));
  assert.ok(account.items.some((item) => item.resource === "secrets" && item.name === "api-token"));

  const binding = await buildRelatedResources({
    resource: "rolebindings",
    namespace: "default",
    targetRaw: fixtureItems("rolebindings")[0],
    loadItems: loader,
  });
  assert.ok(binding.items.some((item) => item.resource === "roles" && item.name === "edit"));
  assert.ok(binding.items.some((item) => item.resource === "serviceaccounts" && item.name === "api-sa"));
});

test("related engine deduplicates links and keeps source failures partial", async () => {
  assert.equal(selectorMatches({ app: "api", tier: "backend" }, { app: "api" }), true);
  assert.equal(selectorMatches({ app: "other" }, { app: "api" }), false);
  const duplicate = relatedLink("pods", "default", "api-0", "Pod", "selected");
  assert.equal(deduplicateRelatedLinks([duplicate, duplicate]).length, 1);

  const result = await buildRelatedResources({
    resource: "services",
    namespace: "default",
    targetRaw: {
      metadata: { name: "api", namespace: "default" },
      spec: { selector: { app: "api" } },
    },
    async loadItems(resource) {
      if (resource === "ingresses") {
        throw new KubectlError({
          code: "FORBIDDEN",
          message: "kubectl command failed",
          rawStderr: "forbidden",
          commandPreview: "kubectl get ingresses -n default -o json",
        });
      }
      return fixtureItems(resource);
    },
  });
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].resource, "ingresses");
  assert.ok(result.items.some((item) => item.resource === "pods"));
});

test("related route builds kubectl commands and preserves response contract", async (t) => {
  const commands = [];
  const runner = {
    async runJson(command) {
      commands.push(command.args);
      const resource = command.args[1];
      const hasName = command.args[2] && !String(command.args[2]).startsWith("-");
      if (hasName) return podTarget();
      return { items: fixtureItems(resource) };
    },
  };
  const body = await buildRelatedResourcesResponse(
    fakeConfigStore(),
    runner,
    {
      clusterId: "cluster-1",
      resource: "pods",
      namespace: "default",
      name: "api-0",
    },
  );
  assert.ok(Array.isArray(body.items));
  assert.equal(typeof body.sources, "object");
  assert.ok(Array.isArray(body.errors));
  assert.ok(commands.some((args) => args.join(" ") === "get pods api-0 -n default -o json"));
  assert.ok(commands.some((args) => args.join(" ") === "get services -n default -o json"));

  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    const handled = handleRelatedResourcesRequest(
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
    `${baseUrl}/clusters/cluster-1/resources/pods/default/api-0/related`,
  );
  assert.equal(response.status, 200);
  const responseBody = await response.json();
  assert.ok(Array.isArray(responseBody.items));
  assert.equal(typeof responseBody.sources, "object");
  assert.ok(Array.isArray(responseBody.errors));
});

test("related route validates matcher and missing cluster before kubectl", async (t) => {
  assert.equal(
    matchRelatedResourcesRoute(
      "POST",
      "/clusters/cluster-1/resources/pods/default/api-0/related",
    ),
    null,
  );
  const target = matchRelatedResourcesRoute(
    "GET",
    "/clusters/cluster-1/resources/nodes/_cluster/worker-1/related",
  );
  assert.deepEqual(target, {
    clusterId: "cluster-1",
    resource: "nodes",
    namespace: "_cluster",
    name: "worker-1",
  });

  let calls = 0;
  const runner = {
    async runJson() {
      calls += 1;
      return {};
    },
  };
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    handleRelatedResourcesRequest(
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
  const response = await fetch(
    `${baseUrl}/clusters/missing/resources/pods/default/api-0/related`,
  );
  assert.equal(response.status, 404);
  assert.equal((await response.json()).detail.code, "CLUSTER_NOT_FOUND");
  assert.equal(calls, 0);
});
