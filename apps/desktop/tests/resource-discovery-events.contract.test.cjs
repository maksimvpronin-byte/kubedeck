const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const {
  clearResourceDefinitionCache,
  filterEventsForTarget,
  handleResourceDiscoveryEventsRequest,
  matchResourceEventsPath,
  parseApiResources,
  summarizeEvent,
} = require("../dist/main/backend/routes/resourceDiscoveryEvents.js");
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

test("resource discovery parser and event normalizer", () => {
  const output = [
    "NAME SHORTNAMES APIVERSION NAMESPACED KIND VERBS CATEGORIES",
    "pods po v1 true Pod [create delete get list patch update watch] all",
    "deployments deploy apps/v1 true Deployment [create delete get list patch update watch] all",
    "bindings v1 true Binding [create]",
    "nodes no v1 false Node [get list patch update watch]",
  ].join("\n");

  assert.deepEqual(parseApiResources(output), [
    {
      name: "pods",
      shortNames: "po",
      apiGroup: "v1",
      namespaced: true,
      kind: "Pod",
      verbs: "[create delete get list patch update watch] all",
    },
    {
      name: "deployments",
      shortNames: "deploy",
      apiGroup: "apps/v1",
      namespaced: true,
      kind: "Deployment",
      verbs: "[create delete get list patch update watch] all",
    },
    {
      name: "bindings",
      shortNames: "",
      apiGroup: "v1",
      namespaced: true,
      kind: "Binding",
      verbs: "[create]",
    },
    {
      name: "nodes",
      shortNames: "no",
      apiGroup: "v1",
      namespaced: false,
      kind: "Node",
      verbs: "[get list patch update watch]",
    },
  ]);

  const target = matchResourceEventsPath(
    "/clusters/demo/resources/pods/default/web-123/events",
  );
  assert.deepEqual(target, {
    clusterId: "demo",
    resource: "pods",
    namespace: "default",
    name: "web-123",
  });

  const targetRaw = {
    kind: "Pod",
    metadata: { uid: "pod-uid", namespace: "default", name: "web-123" },
  };

  const events = [
    {
      metadata: {
        uid: "event-old",
        name: "old",
        namespace: "default",
        creationTimestamp: "2026-06-21T10:00:00Z",
      },
      involvedObject: {
        uid: "pod-uid",
        kind: "Pod",
        namespace: "default",
        name: "web-123",
        apiVersion: "v1",
      },
      type: "Normal",
      reason: "Pulled",
      message: "Image pulled",
      count: 2,
      source: { component: "kubelet" },
      lastTimestamp: "2026-06-21T10:01:00Z",
    },
    {
      metadata: {
        uid: "event-new",
        name: "new",
        namespace: "default",
        creationTimestamp: "2026-06-21T11:00:00Z",
      },
      regarding: {
        uid: "pod-uid",
        kind: "Pod",
        namespace: "default",
        name: "web-123",
        apiVersion: "v1",
      },
      type: "Warning",
      reason: "BackOff",
      note: "Container is restarting",
      series: { count: 3 },
      reportingController: "kubelet",
      eventTime: "2026-06-21T11:02:00Z",
    },
    {
      metadata: { uid: "wrong", namespace: "default" },
      involvedObject: {
        uid: "other-uid",
        kind: "Pod",
        namespace: "default",
        name: "other-pod",
      },
      lastTimestamp: "2026-06-21T12:00:00Z",
    },
  ];

  const filtered = filterEventsForTarget(events, target, targetRaw);
  assert.equal(filtered.length, 2);
  assert.equal(filtered[0].metadata.uid, "event-new");

  assert.deepEqual(summarizeEvent(filtered[0]), {
    uid: "event-new",
    name: "new",
    namespace: "default",
    createdAt: "2026-06-21T11:02:00Z",
    type: "Warning",
    reason: "BackOff",
    message: "Container is restarting",
    object: "Pod/web-123",
    involvedKind: "Pod",
    involvedName: "web-123",
    involvedNamespace: "default",
    involvedApiVersion: "v1",
    count: 3,
    source: "kubelet",
    lastTimestamp: "2026-06-21T11:02:00Z",
  });

  assert.throws(
    () => matchResourceEventsPath(
      "/clusters/demo/resources/pods/default%2Fevil/web-123/events",
    ),
    /path separator/,
  );
});

test("resource discovery and events HTTP handler", async (t) => {
  clearResourceDefinitionCache();

  const commands = [];
  const configStore = {
    load: () => ({ settings: { kubectlPath: "kubectl" } }),
    getCluster: (clusterId) => {
      assert.equal(clusterId, "demo");
      return { kubeconfigPath: "C:\\KubeDeck\\demo.yaml" };
    },
  };

  const runner = {
    run: async (command) => {
      commands.push(command);
      return {
        stdout: [
          "NAME SHORTNAMES APIVERSION NAMESPACED KIND VERBS CATEGORIES",
          "pods po v1 true Pod [get list watch] all",
          "nodes no v1 false Node [get list watch]",
        ].join("\n"),
      };
    },
    runJson: async (command) => {
      commands.push(command);

      if (command.args[0] === "get" && command.args[1] === "missing") {
        throw new KubectlError({
          code: "NOT_FOUND",
          message: "resource not found",
          rawStderr: "Error from server (NotFound)",
          commandPreview: "kubectl get missing",
        });
      }

      if (command.args[0] === "get" && command.args[1] === "events") {
        return {
          items: [
            {
              metadata: {
                uid: "event-a",
                name: "event-a",
                namespace: "default",
                creationTimestamp: "2026-06-21T12:00:00Z",
              },
              involvedObject: {
                uid: "pod-uid",
                kind: "Pod",
                namespace: "default",
                name: "web-123",
                apiVersion: "v1",
              },
              type: "Normal",
              reason: "Started",
              message: "Started container",
              count: 1,
              lastTimestamp: "2026-06-21T12:01:00Z",
            },
            {
              metadata: { uid: "event-b", namespace: "default" },
              involvedObject: {
                uid: "other",
                kind: "Pod",
                namespace: "default",
                name: "other",
              },
            },
          ],
        };
      }

      return {
        apiVersion: "v1",
        kind: "Pod",
        metadata: {
          uid: "pod-uid",
          name: "web-123",
          namespace: "default",
        },
      };
    },
  };

  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const handled = handleResourceDiscoveryEventsRequest(
      request,
      response,
      pathname,
      configStore,
      runner,
      () => {},
    );

    if (!handled) {
      response.statusCode = 404;
      response.end();
    }
  });

  const baseUrl = await listen(server);
  t.after(async () => close(server));

  const definitions = await fetch(
    `${baseUrl}/clusters/demo/resource-definitions`,
  );
  assert.equal(definitions.status, 200);
  assert.deepEqual(await definitions.json(), {
    items: [
      {
        name: "pods",
        shortNames: "po",
        apiGroup: "v1",
        namespaced: true,
        kind: "Pod",
        verbs: "[get list watch] all",
      },
      {
        name: "nodes",
        shortNames: "no",
        apiGroup: "v1",
        namespaced: false,
        kind: "Node",
        verbs: "[get list watch]",
      },
    ],
    cached: false,
  });
  assert.deepEqual(commands.at(-1).args, [
    "api-resources",
    "--verbs=list",
    "-o",
    "wide",
  ]);
  assert.equal(commands.at(-1).timeoutSeconds, 30);

  const cachedDefinitions = await fetch(
    `${baseUrl}/clusters/demo/resource-definitions`,
  );
  assert.equal(cachedDefinitions.status, 200);
  assert.equal((await cachedDefinitions.json()).cached, true);
  assert.equal(commands.length, 1);

  const events = await fetch(
    `${baseUrl}/clusters/demo/resources/pods/default/web-123/events`,
  );
  assert.equal(events.status, 200);
  const eventBody = await events.json();
  assert.equal(eventBody.rawCount, 1);
  assert.equal(eventBody.items[0].reason, "Started");
  assert.deepEqual(commands.at(-2).args, [
    "get",
    "pods",
    "web-123",
    "-n",
    "default",
    "-o",
    "json",
  ]);
  assert.deepEqual(commands.at(-1).args, [
    "get",
    "events",
    "-n",
    "default",
    "-o",
    "json",
  ]);

  const nodeEvents = await fetch(
    `${baseUrl}/clusters/demo/resources/nodes/_cluster/node-a/events`,
  );
  assert.equal(nodeEvents.status, 200);
  assert.deepEqual(commands.at(-1).args, [
    "get",
    "events",
    "-A",
    "-o",
    "json",
  ]);

  const invalidNamespace = await fetch(
    `${baseUrl}/clusters/demo/resources/pods/default%2Fevil/web-123/events`,
  );
  assert.equal(invalidNamespace.status, 400);
  assert.equal(
    (await invalidNamespace.json()).detail.code,
    "INVALID_IDENTIFIER",
  );

  const missing = await fetch(
    `${baseUrl}/clusters/demo/resources/missing/default/web-123/events`,
  );
  assert.equal(missing.status, 502);
  assert.equal((await missing.json()).detail.code, "NOT_FOUND");
});
