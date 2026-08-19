const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { buildRelatedResources, deduplicateRelatedLinks, relatedLink, selectorMatches } = require("../dist/main/backend/relations/relatedResourcesEngine.js");
const { buildRelatedResourcesResponse, handleRelatedResourcesRequest, matchRelatedResourcesRoute } = require("../dist/main/backend/routes/relatedResources.js");
const { ClusterNotFoundError } = require("../dist/main/backend/config/configStore.js");
const { KubectlError } = require("../dist/main/backend/kubectl/errors.js");
const { clearApiResourcesCache } = require("../dist/main/backend/resources/apiResourcesCache.js");

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
        clusters: [{ id: "cluster-1", kubeconfigPath: "C:\\temp\\cluster-1.yaml" }],
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

const ROUTE_RESOURCES = [
  "ingressroutes.traefik.io",
  "middlewares.traefik.io",
  "httproutes.gateway.networking.k8s.io",
  "gateways.gateway.networking.k8s.io",
  "gatewayclasses.gateway.networking.k8s.io",
];

function traefikRoute() {
  return {
    apiVersion: "traefik.io/v1alpha1",
    kind: "IngressRoute",
    metadata: { name: "api-route", namespace: "default" },
    spec: {
      entryPoints: ["websecure"],
      routes: [
        {
          match: "Host(`api.example.com`)",
          kind: "Rule",
          services: [{ name: "api", port: 80 }],
          middlewares: [{ name: "api-auth" }],
        },
      ],
      tls: { secretName: "api-cert" },
    },
  };
}

function httpRoute() {
  return {
    apiVersion: "gateway.networking.k8s.io/v1",
    kind: "HTTPRoute",
    metadata: { name: "api-http", namespace: "default" },
    spec: {
      parentRefs: [{ name: "public", namespace: "traefik", sectionName: "websecure" }],
      rules: [{ backendRefs: [{ name: "api", port: 80 }] }],
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
          volumes: [{ persistentVolumeClaim: { claimName: "api-data" } }, { configMap: { name: "api-config" } }],
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
                paths: [{ backend: { service: { name: "api", port: { number: 80 } } } }],
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
    "ingressroutes.traefik.io": [traefikRoute()],
    "httproutes.gateway.networking.k8s.io": [httpRoute()],
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
  const body = await buildRelatedResourcesResponse(fakeConfigStore(), runner, {
    clusterId: "cluster-1",
    resource: "pods",
    namespace: "default",
    name: "api-0",
  });
  assert.ok(Array.isArray(body.items));
  assert.equal(typeof body.sources, "object");
  assert.ok(Array.isArray(body.errors));
  assert.ok(commands.some((args) => args.join(" ") === "get pods api-0 -n default -o json"));
  assert.ok(commands.some((args) => args.join(" ") === "get services -n default -o json"));

  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    const handled = handleRelatedResourcesRequest(request, response, pathname, fakeConfigStore(), runner, () => {});
    if (!handled) {
      response.statusCode = 404;
      response.end();
    }
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));
  const response = await fetch(`${baseUrl}/clusters/cluster-1/resources/pods/default/api-0/related`);
  assert.equal(response.status, 200);
  const responseBody = await response.json();
  assert.ok(Array.isArray(responseBody.items));
  assert.equal(typeof responseBody.sources, "object");
  assert.ok(Array.isArray(responseBody.errors));
});

test("related route validates matcher and missing cluster before kubectl", async (t) => {
  assert.equal(matchRelatedResourcesRoute("POST", "/clusters/cluster-1/resources/pods/default/api-0/related"), null);
  const target = matchRelatedResourcesRoute("GET", "/clusters/cluster-1/resources/nodes/_cluster/worker-1/related");
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
    handleRelatedResourcesRequest(request, response, pathname, fakeConfigStore(), runner, () => {});
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));
  const response = await fetch(`${baseUrl}/clusters/missing/resources/pods/default/api-0/related`);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).detail.code, "CLUSTER_NOT_FOUND");
  assert.equal(calls, 0);
});

test("service and pod relations reach Traefik IngressRoutes and Gateway API HTTPRoutes", async () => {
  const scanned = [];
  const loadItems = async (resource, namespace) => {
    scanned.push(`${resource}:${namespace}`);
    return fixtureItems(resource);
  };

  const service = await buildRelatedResources({
    resource: "services",
    namespace: "default",
    targetRaw: { apiVersion: "v1", kind: "Service", metadata: { name: "api", namespace: "default" }, spec: { selector: { app: "api" } } },
    availableResources: ROUTE_RESOURCES,
    loadItems,
  });
  const serviceRoute = service.items.find((item) => item.resource === "ingressroutes.traefik.io");
  assert.equal(serviceRoute.name, "api-route");
  assert.equal(serviceRoute.kind, "IngressRoute");
  assert.equal(serviceRoute.relation, "routes to service");
  assert.ok(service.items.some((item) => item.resource === "httproutes.gateway.networking.k8s.io" && item.relation === "routes to service"));
  assert.ok(service.items.some((item) => item.resource === "ingresses" && item.name === "api-ingress"));
  assert.equal(service.errors.length, 0);

  const pod = await buildRelatedResources({
    resource: "pods",
    namespace: "default",
    targetRaw: podTarget(),
    availableResources: ROUTE_RESOURCES,
    loadItems,
  });
  const podRoute = pod.items.find((item) => item.resource === "ingressroutes.traefik.io");
  assert.equal(podRoute.relation, "routes to pod");
  assert.equal(podRoute.detail, "via service api");
  assert.ok(pod.items.some((item) => item.resource === "ingresses" && item.relation === "routes to pod"));
  assert.ok(pod.items.some((item) => item.resource === "httproutes.gateway.networking.k8s.io" && item.relation === "routes to pod"));
  // Traefik and Gateway API allow a route to reference a Service in another
  // namespace, so these are scanned cluster-wide rather than scoped to the
  // target's own namespace (unlike vanilla Ingress, which cannot cross namespaces).
  assert.ok(scanned.includes("ingressroutes.traefik.io:all"));
  assert.ok(scanned.includes("ingresses:default"));
});

test("route CRDs are only scanned when discovery lists them", async () => {
  const scanned = [];
  const result = await buildRelatedResources({
    resource: "services",
    namespace: "default",
    targetRaw: { apiVersion: "v1", kind: "Service", metadata: { name: "api", namespace: "default" }, spec: { selector: { app: "api" } } },
    async loadItems(resource, namespace) {
      scanned.push(`${resource}:${namespace}`);
      return fixtureItems(resource);
    },
  });
  assert.ok(!scanned.some((entry) => entry.includes("traefik") || entry.includes("gateway.networking")));
  assert.equal(result.errors.length, 0);
  assert.ok(result.items.some((item) => item.resource === "ingresses"));
});

test("cross-namespace Traefik and Gateway API routes are still found from the Service they target", async () => {
  // The IngressRoute/HTTPRoute/Middleware live in "ingress-ns" and reference a
  // Service (and, for the middleware case, a Middleware) in "app-ns" via an
  // explicit namespace override - a real pattern where routing objects are
  // centralized in one namespace instead of living alongside every workload.
  const crossNamespaceRoute = {
    apiVersion: "traefik.io/v1alpha1",
    kind: "IngressRoute",
    metadata: { name: "shared-route", namespace: "ingress-ns" },
    spec: {
      routes: [{ services: [{ name: "api", namespace: "app-ns" }], middlewares: [{ name: "shared-auth", namespace: "app-ns" }] }],
    },
  };
  const crossNamespaceHttpRoute = {
    apiVersion: "gateway.networking.k8s.io/v1",
    kind: "HTTPRoute",
    metadata: { name: "shared-http-route", namespace: "ingress-ns" },
    spec: { rules: [{ backendRefs: [{ name: "api", namespace: "app-ns" }] }] },
  };

  const service = await buildRelatedResources({
    resource: "services",
    namespace: "app-ns",
    targetRaw: { apiVersion: "v1", kind: "Service", metadata: { name: "api", namespace: "app-ns" }, spec: {} },
    availableResources: ROUTE_RESOURCES,
    async loadItems(resource, namespace) {
      assert.equal(namespace, "all", `cross-namespace-capable source "${resource}" must be scanned cluster-wide, not scoped to the service's namespace`);
      if (resource === "ingressroutes.traefik.io") return [crossNamespaceRoute];
      if (resource === "httproutes.gateway.networking.k8s.io") return [crossNamespaceHttpRoute];
      return [];
    },
  });
  const routeLink = service.items.find((item) => item.resource === "ingressroutes.traefik.io");
  assert.ok(routeLink, "an IngressRoute living in another namespace must still be found by its cross-namespace service ref");
  assert.equal(routeLink.namespace, "ingress-ns", "the link must point at the route's own namespace, not the service's");
  assert.ok(service.items.some((item) => item.resource === "httproutes.gateway.networking.k8s.io" && item.namespace === "ingress-ns"));

  const middleware = await buildRelatedResources({
    resource: "middlewares.traefik.io",
    namespace: "app-ns",
    targetRaw: { apiVersion: "traefik.io/v1alpha1", kind: "Middleware", metadata: { name: "shared-auth", namespace: "app-ns" } },
    availableResources: ROUTE_RESOURCES,
    async loadItems(resource, namespace) {
      if (resource === "ingressroutes.traefik.io") {
        assert.equal(namespace, "all", "routes referencing a middleware in another namespace must be scanned cluster-wide");
        return [crossNamespaceRoute];
      }
      return [];
    },
  });
  const middlewareLink = middleware.items.find((item) => item.resource === "ingressroutes.traefik.io");
  assert.ok(middlewareLink, "an IngressRoute in another namespace referencing this Middleware must still be found");
  assert.equal(middlewareLink.namespace, "ingress-ns");
});

test("Traefik route targets link services, middleware and TLS secret", async () => {
  const route = await buildRelatedResources({
    resource: "ingressroutes.traefik.io",
    namespace: "default",
    targetRaw: traefikRoute(),
    availableResources: ROUTE_RESOURCES,
    async loadItems(resource) {
      return fixtureItems(resource);
    },
  });
  const keys = new Set(route.items.map((item) => `${item.resource}/${item.name}/${item.relation}`));
  assert.ok(keys.has("services/api/used by route"));
  assert.ok(keys.has("middlewares.traefik.io/api-auth/uses middleware"));
  assert.ok(keys.has("secrets/api-cert/tls certificate"));
  assert.equal(route.items.find((item) => item.resource === "services").detail, "port 80");

  const middleware = await buildRelatedResources({
    resource: "middlewares.traefik.io",
    namespace: "default",
    targetRaw: { apiVersion: "traefik.io/v1alpha1", kind: "Middleware", metadata: { name: "api-auth", namespace: "default" } },
    availableResources: ROUTE_RESOURCES,
    async loadItems(resource) {
      return fixtureItems(resource);
    },
  });
  assert.ok(middleware.items.some((item) => item.resource === "ingressroutes.traefik.io" && item.relation === "uses this middleware"));
});

test("Gateway API targets link backends, parent gateways and certificates", async () => {
  const route = await buildRelatedResources({
    resource: "httproutes.gateway.networking.k8s.io",
    namespace: "default",
    targetRaw: httpRoute(),
    availableResources: ROUTE_RESOURCES,
    async loadItems(resource) {
      return fixtureItems(resource);
    },
  });
  assert.ok(route.items.some((item) => item.resource === "services" && item.name === "api" && item.relation === "used by route"));
  const parent = route.items.find((item) => item.resource === "gateways.gateway.networking.k8s.io");
  assert.equal(parent.namespace, "traefik");
  assert.equal(parent.detail, "listener websecure");

  const gateway = await buildRelatedResources({
    resource: "gateways.gateway.networking.k8s.io",
    namespace: "traefik",
    targetRaw: {
      apiVersion: "gateway.networking.k8s.io/v1",
      kind: "Gateway",
      metadata: { name: "public", namespace: "traefik" },
      spec: {
        gatewayClassName: "traefik",
        listeners: [{ name: "websecure", tls: { certificateRefs: [{ kind: "Secret", name: "wildcard-cert" }] } }],
      },
    },
    availableResources: ROUTE_RESOURCES,
    async loadItems(resource) {
      return resource === "httproutes.gateway.networking.k8s.io" ? [httpRoute()] : fixtureItems(resource);
    },
  });
  const keys = new Set(gateway.items.map((item) => `${item.resource}/${item.name}/${item.relation}`));
  assert.ok(keys.has("gatewayclasses.gateway.networking.k8s.io/traefik/gateway class"));
  assert.ok(keys.has("secrets/wildcard-cert/tls certificate"));
  assert.ok(keys.has("httproutes.gateway.networking.k8s.io/api-http/attached to this gateway"));
});

test("ingress targets expose their TLS secrets", async () => {
  const result = await buildRelatedResources({
    resource: "ingresses",
    namespace: "default",
    targetRaw: {
      apiVersion: "networking.k8s.io/v1",
      kind: "Ingress",
      metadata: { name: "api-ingress", namespace: "default" },
      spec: {
        tls: [{ hosts: ["api.example.com"], secretName: "api-tls" }],
        rules: [{ http: { paths: [{ backend: { service: { name: "api" } } }] } }],
      },
    },
    async loadItems(resource) {
      return fixtureItems(resource);
    },
  });
  assert.ok(result.items.some((item) => item.resource === "secrets" && item.name === "api-tls" && item.relation === "tls certificate"));
  assert.ok(result.items.some((item) => item.resource === "services" && item.name === "api"));
});

test("related route scans route CRDs that api-resources reports", async (t) => {
  clearApiResourcesCache();
  t.after(() => clearApiResourcesCache());
  const commands = [];
  const runner = {
    async run(command) {
      commands.push(command.args);
      return {
        stdout: [
          "NAME SHORTNAMES APIVERSION NAMESPACED KIND VERBS",
          "services svc v1 true Service [get list watch]",
          "ingressroutes traefik.io/v1alpha1 true IngressRoute [get list watch]",
          "httproutes gateway.networking.k8s.io/v1 true HTTPRoute [get list watch]",
          "gatewayclasses gc gateway.networking.k8s.io/v1 false GatewayClass [get list watch]",
        ].join("\n"),
      };
    },
    async runJson(command) {
      commands.push(command.args);
      const resource = command.args[1];
      const hasName = command.args[2] && !String(command.args[2]).startsWith("-");
      if (hasName) return { apiVersion: "v1", kind: "Service", metadata: { name: "api", namespace: "default" }, spec: { selector: { app: "api" } } };
      return { items: fixtureItems(resource) };
    },
  };

  const body = await buildRelatedResourcesResponse(fakeConfigStore(), runner, {
    clusterId: "cluster-1",
    resource: "services",
    namespace: "default",
    name: "api",
  });
  assert.ok(commands.some((args) => args.join(" ") === "api-resources --verbs=list -o wide"));
  // Traefik routes can reference a Service in another namespace, so this is
  // scanned cluster-wide (-A) rather than scoped to the service's namespace.
  assert.ok(commands.some((args) => args.join(" ") === "get ingressroutes.traefik.io -A -o json"));
  assert.ok(body.items.some((item) => item.resource === "ingressroutes.traefik.io" && item.name === "api-route"));
  assert.ok(body.items.some((item) => item.resource === "httproutes.gateway.networking.k8s.io"));
  assert.equal(body.errors.length, 0);

  const gatewayClass = await buildRelatedResourcesResponse(fakeConfigStore(), runner, {
    clusterId: "cluster-1",
    resource: "gatewayclasses.gateway.networking.k8s.io",
    namespace: "_cluster",
    name: "traefik",
  });
  assert.ok(Array.isArray(gatewayClass.items));
  assert.ok(!commands.some((args) => args[1] === "gatewayclasses.gateway.networking.k8s.io" && args.includes("-n")));
});
