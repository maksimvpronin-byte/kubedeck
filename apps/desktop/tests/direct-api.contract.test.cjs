const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");

const { KubectlRunner } = require("../dist/main/backend/kubectl/runner.js");
const { createKubectlCommand } = require("../dist/main/backend/kubectl/command.js");
const { DirectApiTransport, rawGetPath } = require("../dist/main/backend/api/directApi.js");
const { connectionProfile, clearConnectionProfiles } = require("../dist/main/backend/api/kubeconfigProfile.js");
const { bypassesProxy, proxyFor } = require("../dist/main/backend/api/proxyRoute.js");
const { ExecCredentialCache } = require("../dist/main/backend/api/execCredentials.js");

// KubeDeck used to start a kubectl process for every read: on Windows with an
// antivirus that is hundreds of milliseconds before the request even leaves,
// plus the auth plugin and a fresh TLS handshake each time. Raw GETs are now
// answered by KubeDeck's own client over a kept connection, and everything it
// does not understand still goes to kubectl.

const FIXTURES = path.join(__dirname, "fixtures", "direct-api");
const pem = (name) => fs.readFileSync(path.join(FIXTURES, name), "utf8");
const b64 = (text) => Buffer.from(text).toString("base64");

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kubedeck-direct-api-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeKubeconfig(dir, { server, cluster = {}, user = {}, name = "config" }) {
  const file = path.join(dir, name);
  const doc = {
    apiVersion: "v1",
    kind: "Config",
    "current-context": "ctx",
    contexts: [{ name: "ctx", context: { cluster: "c", user: "u" } }],
    clusters: [{ name: "c", cluster: { server, ...cluster } }],
    users: [{ name: "u", user }],
  };
  fs.writeFileSync(file, JSON.stringify(doc));
  clearConnectionProfiles();
  return file;
}

function kubectlSpawn(calls, stdout = '{"from":"kubectl"}') {
  return (command, args) => {
    calls.push(args.join(" "));
    const child = new EventEmitter();
    child.pid = 10_000 + calls.length;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = () => true;
    setImmediate(() => {
      child.stdout.end(stdout);
      child.stderr.end();
      child.emit("close", 0);
    });
    return child;
  };
}

function rawCommand(kubeconfigPath, apiPath, extra = {}) {
  return createKubectlCommand({ clusterId: "c1", kubeconfigPath, kubectlPath: "kubectl", args: ["get", "--raw", apiPath], timeoutSeconds: 30, maxOutputBytes: 1024 * 1024, directApi: true, ...extra });
}

function setup(t) {
  const logs = [];
  const kubectlCalls = [];
  const direct = new DirectApiTransport((line) => logs.push(line));
  const runner = new KubectlRunner((line) => logs.push(line), kubectlSpawn(kubectlCalls), direct);
  t.after(() => direct.close());
  return { runner, direct, logs, kubectlCalls };
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}

function closeServer(t, server) {
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  );
}

async function tlsServer(t, handler, options = {}) {
  const requests = [];
  let connections = 0;
  const server = https.createServer({ key: pem("server.key"), cert: pem("server.crt"), ...options }, (request, response) => {
    requests.push({ url: request.url, headers: request.headers, peer: request.socket.getPeerCertificate?.()?.subject?.CN ?? null });
    handler(request, response);
  });
  server.on("secureConnection", () => connections++);
  closeServer(t, server);
  const port = await listen(server);
  return { port, requests, connections: () => connections };
}

const json = (response, status, body, headers = {}) => {
  response.writeHead(status, { "Content-Type": "application/json", ...headers });
  response.end(JSON.stringify(body));
};

test("only a plain raw GET is taken off kubectl", () => {
  assert.equal(rawGetPath(["get", "--raw", "/api/v1/pods"]), "/api/v1/pods");
  assert.equal(rawGetPath(["get", "--raw=/readyz"]), "/readyz");
  assert.equal(rawGetPath(["get", "pods", "-o", "json"]), null);
  assert.equal(rawGetPath(["get", "--raw", "/api", "-v=9"]), null);
  assert.equal(rawGetPath(["delete", "--raw", "/api/v1/pods/x"]), null);
});

test("a raw GET goes to the API server over one kept TLS connection with the kubeconfig's token", async (t) => {
  const server = await tlsServer(t, (request, response) => {
    const body = zlib.gzipSync(JSON.stringify({ kind: "PodList", apiVersion: "v1", items: [{ metadata: { name: "a" } }] }));
    response.writeHead(200, { "Content-Type": "application/json", "Content-Encoding": "gzip" });
    response.end(body);
  });
  const dir = tempDir(t);
  const kubeconfig = writeKubeconfig(dir, { server: `https://127.0.0.1:${server.port}`, cluster: { "certificate-authority-data": b64(pem("ca.crt")) }, user: { token: "secret-token" } });
  const { runner, kubectlCalls, logs } = setup(t);

  const first = await runner.runJson(rawCommand(kubeconfig, "/api/v1/pods"));
  const second = await runner.runJson(rawCommand(kubeconfig, "/api/v1/namespaces/shop/pods"));

  assert.equal(first.items[0].metadata.name, "a", "gzip is undone");
  assert.equal(second.kind, "PodList");
  assert.deepEqual(kubectlCalls, [], "no kubectl process");
  assert.deepEqual(
    server.requests.map((request) => request.url),
    ["/api/v1/pods", "/api/v1/namespaces/shop/pods"],
  );
  assert.equal(server.requests[0].headers.authorization, "Bearer secret-token");
  assert.equal(server.connections(), 1, "the second request reuses the first connection");
  assert.ok(!logs.join("\n").includes("secret-token"), "the token is never logged");
});

test("a client certificate from files next to the kubeconfig authenticates the request", async (t) => {
  const server = await tlsServer(t, (request, response) => json(response, 200, { kind: "Status", ok: true }), { ca: pem("ca.crt"), requestCert: true, rejectUnauthorized: true });
  const dir = tempDir(t);
  fs.mkdirSync(path.join(dir, "certs"));
  fs.writeFileSync(path.join(dir, "certs", "ca.crt"), pem("ca.crt"));
  fs.writeFileSync(path.join(dir, "certs", "client.crt"), pem("client.crt"));
  fs.writeFileSync(path.join(dir, "certs", "client.key"), pem("client.key"));
  const kubeconfig = writeKubeconfig(dir, {
    server: `https://localhost:${server.port}`,
    cluster: { "certificate-authority": "certs/ca.crt" },
    user: { "client-certificate": "certs/client.crt", "client-key": "certs/client.key" },
  });
  const { runner, kubectlCalls } = setup(t);

  const result = await runner.runJson(rawCommand(kubeconfig, "/version"));
  assert.equal(result.ok, true);
  assert.equal(server.requests[0].peer, "kubedeck-test-user");
  assert.deepEqual(kubectlCalls, []);
});

test("a server under a path prefix keeps its prefix", async (t) => {
  const server = await tlsServer(t, (request, response) => json(response, 200, { ok: true }));
  const dir = tempDir(t);
  const kubeconfig = writeKubeconfig(dir, { server: `https://127.0.0.1:${server.port}/k8s/clusters/c-1/`, cluster: { "certificate-authority-data": b64(pem("ca.crt")) }, user: { token: "t" } });
  const { runner } = setup(t);
  await runner.runJson(rawCommand(kubeconfig, "/api/v1/nodes"));
  assert.equal(server.requests[0].url, "/k8s/clusters/c-1/api/v1/nodes");
});

test("API server refusals fail with kubectl's codes and wording", async (t) => {
  const server = await tlsServer(t, (request, response) => {
    if (request.url.includes("forbidden")) {
      json(response, 403, { kind: "Status", reason: "Forbidden", message: 'pods is forbidden: User "u" cannot list resource "pods"' });
    } else if (request.url.includes("unauthorized")) {
      json(response, 401, { kind: "Status", reason: "Unauthorized", message: "Unauthorized" });
    } else json(response, 404, { kind: "Status", reason: "NotFound", message: "the server could not find the requested resource" });
  });
  const dir = tempDir(t);
  const kubeconfig = writeKubeconfig(dir, { server: `https://127.0.0.1:${server.port}`, cluster: { "certificate-authority-data": b64(pem("ca.crt")) }, user: { token: "t" } });
  const { runner, kubectlCalls } = setup(t);

  const failure = (apiPath) =>
    runner.run(rawCommand(kubeconfig, apiPath)).then(
      () => assert.fail("expected a failure"),
      (error) => error.info,
    );
  const notFound = await failure("/apis/nope/v1/things");
  assert.equal(notFound.code, "NOT_FOUND");
  assert.match(notFound.rawStderr, /Error from server \(NotFound\)/);
  const forbidden = await failure("/api/v1/forbidden");
  assert.equal(forbidden.code, "FORBIDDEN");
  assert.match(forbidden.rawStderr, /forbidden/);
  const unauthorized = await failure("/api/v1/unauthorized");
  assert.equal(unauthorized.code, "UNAUTHORIZED");
  assert.match(unauthorized.rawStderr, /Unauthorized/);
  assert.deepEqual(kubectlCalls, [], "an answer from the server is reported, not retried through kubectl");
});

test("an unreachable server reads as unreachable, the way the window recognises it", async (t) => {
  const port = await new Promise((resolve) => {
    const probe = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
  const dir = tempDir(t);
  const kubeconfig = writeKubeconfig(dir, { server: `https://127.0.0.1:${port}`, cluster: { "certificate-authority-data": b64(pem("ca.crt")) }, user: { token: "t" } });
  const { runner, kubectlCalls } = setup(t);
  await assert.rejects(runner.run(rawCommand(kubeconfig, "/readyz")), (error) => {
    assert.equal(error.info.code, "CLUSTER_UNAVAILABLE");
    assert.match(error.info.rawStderr, /connection refused/);
    return true;
  });
  assert.deepEqual(kubectlCalls, [], "a dead server is not asked twice");
});

test("a server Node does not trust is left to kubectl, and stays with kubectl", async (t) => {
  const server = await tlsServer(t, (request, response) => json(response, 200, { ok: true }));
  const dir = tempDir(t);
  // No CA: kubectl would use the system store, where this test CA is not.
  const kubeconfig = writeKubeconfig(dir, { server: `https://127.0.0.1:${server.port}`, user: { token: "t" } });
  const { runner, kubectlCalls, logs } = setup(t);

  assert.deepEqual(await runner.runJson(rawCommand(kubeconfig, "/api")), { from: "kubectl" });
  assert.deepEqual(await runner.runJson(rawCommand(kubeconfig, "/api")), { from: "kubectl" });
  assert.equal(kubectlCalls.length, 2);
  assert.equal(server.requests.length, 0, "the TLS handshake failed before any request");
  assert.equal(logs.filter((line) => line.includes("node api using kubectl")).length, 1, "said once");
});

test("kubeconfigs with features the client does not handle go to kubectl", async (t) => {
  const dir = tempDir(t);
  const server = "https://127.0.0.1:1";
  const cases = {
    "auth-provider": { user: { "auth-provider": { name: "oidc", config: {} } } },
    impersonation: { user: { token: "t", as: "admin" } },
    "basic auth": { user: { username: "u", password: "p" } },
    "socks proxy": { cluster: { "proxy-url": "socks5://127.0.0.1:1080" }, user: { token: "t" } },
    "interactive exec": { user: { exec: { apiVersion: "client.authentication.k8s.io/v1", command: "login", interactiveMode: "Always" } } },
  };
  for (const [label, spec] of Object.entries(cases)) {
    const kubeconfig = writeKubeconfig(dir, { server, name: label.replaceAll(" ", "-"), ...spec });
    if (label !== "socks proxy") assert.equal(connectionProfile(kubeconfig).profile, null, label);
    const { runner, kubectlCalls } = setup(t);
    assert.deepEqual(await runner.runJson(rawCommand(kubeconfig, "/api")), { from: "kubectl" }, label);
    assert.equal(kubectlCalls.length, 1, label);
  }
});

test("turning the setting off sends every request to kubectl", async (t) => {
  const server = await tlsServer(t, (request, response) => json(response, 200, { ok: true }));
  const dir = tempDir(t);
  const kubeconfig = writeKubeconfig(dir, { server: `https://127.0.0.1:${server.port}`, cluster: { "certificate-authority-data": b64(pem("ca.crt")) }, user: { token: "t" } });
  const { runner, kubectlCalls } = setup(t);
  await runner.runJson(rawCommand(kubeconfig, "/api", { directApi: false }));
  await runner.run(createKubectlCommand({ clusterId: "c1", kubeconfigPath: kubeconfig, args: ["get", "pods", "-o", "json"], directApi: true }));
  assert.equal(kubectlCalls.length, 2);
  assert.equal(server.requests.length, 0);
});

test("a cancelled request stops at once and an oversized answer is refused", async (t) => {
  const server = await tlsServer(t, (request, response) => {
    if (request.url === "/hang") return;
    json(response, 200, { items: "x".repeat(4096) });
  });
  const dir = tempDir(t);
  const kubeconfig = writeKubeconfig(dir, { server: `https://127.0.0.1:${server.port}`, cluster: { "certificate-authority-data": b64(pem("ca.crt")) }, user: { token: "t" } });
  const { runner } = setup(t);

  const controller = new AbortController();
  const pending = runner.run(rawCommand(kubeconfig, "/hang"), controller.signal);
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(pending, (error) => error.info.code === "KUBECTL_CANCELLED");

  await assert.rejects(runner.run(rawCommand(kubeconfig, "/big", { maxOutputBytes: 1024 })), (error) => error.info.code === "OUTPUT_TOO_LARGE");
});

test("an HTTP proxy from the kubeconfig carries the connection through CONNECT", async (t) => {
  const server = await tlsServer(t, (request, response) => json(response, 200, { ok: true }));
  const tunnels = [];
  const proxy = http.createServer();
  proxy.on("connect", (request, socket, head) => {
    tunnels.push(request.url);
    const [host, port] = request.url.split(":");
    const upstream = net.connect(Number(port), host, () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });
  closeServer(t, proxy);
  const proxyPort = await listen(proxy);
  const dir = tempDir(t);
  const kubeconfig = writeKubeconfig(dir, {
    server: `https://localhost:${server.port}`,
    cluster: { "certificate-authority-data": b64(pem("ca.crt")), "proxy-url": `http://127.0.0.1:${proxyPort}` },
    user: { token: "t" },
  });
  const { runner, kubectlCalls } = setup(t);
  assert.deepEqual(await runner.runJson(rawCommand(kubeconfig, "/api")), { ok: true });
  assert.deepEqual(tunnels, [`localhost:${server.port}`]);
  assert.deepEqual(kubectlCalls, []);
});

test("NO_PROXY is read the way kubectl reads it, CIDR ranges included", () => {
  assert.equal(bypassesProxy("10.20.30.40", "6443", "localhost,10.0.0.0/8"), true);
  assert.equal(bypassesProxy("172.20.0.1", "6443", "10.0.0.0/8,192.168.0.0/16"), false);
  assert.equal(bypassesProxy("api.corp.example", "443", ".corp.example"), true);
  assert.equal(bypassesProxy("api.corp.example", "443", "corp.example"), true);
  assert.equal(bypassesProxy("notcorp.example", "443", "corp.example"), false);
  assert.equal(bypassesProxy("api.example", "6443", "api.example:443"), false);
  assert.equal(bypassesProxy("anything", "1", "*"), true);
  assert.equal(bypassesProxy("fd00::1", "6443", "fd00::/8"), true);

  const server = new URL("https://10.1.2.3:6443");
  assert.equal(proxyFor(server, null, { HTTPS_PROXY: "proxy:3128", NO_PROXY: "10.0.0.0/8" }), null);
  assert.equal(proxyFor(server, null, { HTTPS_PROXY: "proxy:3128" }), "http://proxy:3128");
  assert.equal(proxyFor(server, "http://explicit:8080", { NO_PROXY: "*" }), "http://explicit:8080", "proxy-url ignores NO_PROXY, as in client-go");
});

function execPlugin(dir, { tokens, expiresInSeconds = null }) {
  const counter = path.join(dir, "runs");
  const seen = path.join(dir, "exec-info");
  const script = path.join(dir, "plugin.cjs");
  fs.writeFileSync(
    script,
    `const fs = require("fs");
const runs = (fs.existsSync(${JSON.stringify(counter)}) ? Number(fs.readFileSync(${JSON.stringify(counter)}, "utf8")) : 0) + 1;
fs.writeFileSync(${JSON.stringify(counter)}, String(runs));
fs.writeFileSync(${JSON.stringify(seen)}, process.env.KUBERNETES_EXEC_INFO || "");
const tokens = ${JSON.stringify(tokens)};
const status = { token: tokens[Math.min(runs, tokens.length) - 1] };
${expiresInSeconds === null ? "" : `status.expirationTimestamp = new Date(Date.now() + ${expiresInSeconds} * 1000).toISOString();`}
process.stdout.write(JSON.stringify({ apiVersion: "client.authentication.k8s.io/v1", kind: "ExecCredential", status }));`,
  );
  return {
    exec: {
      apiVersion: "client.authentication.k8s.io/v1",
      command: process.execPath,
      args: [script],
      env: [{ name: "PLUGIN_MODE", value: "test" }],
      provideClusterInfo: true,
      interactiveMode: "Never",
    },
    runs: () => Number(fs.readFileSync(counter, "utf8")),
    execInfo: () => JSON.parse(fs.readFileSync(seen, "utf8")),
  };
}

test("an exec plugin runs once for many requests, not once per request", async (t) => {
  const server = await tlsServer(t, (request, response) => json(response, 200, { auth: request.headers.authorization }));
  const dir = tempDir(t);
  const plugin = execPlugin(dir, { tokens: ["from-plugin"], expiresInSeconds: 3600 });
  const kubeconfig = writeKubeconfig(dir, { server: `https://127.0.0.1:${server.port}`, cluster: { "certificate-authority-data": b64(pem("ca.crt")) }, user: { exec: plugin.exec } });
  const { runner, kubectlCalls } = setup(t);

  const answers = await Promise.all([1, 2, 3].map(() => runner.runJson(rawCommand(kubeconfig, "/api"))));
  await runner.runJson(rawCommand(kubeconfig, "/api"));
  assert.deepEqual(
    answers.map((answer) => answer.auth),
    ["Bearer from-plugin", "Bearer from-plugin", "Bearer from-plugin"],
  );
  assert.equal(plugin.runs(), 1, "concurrent requests share one plugin run, and the credential is kept");
  assert.deepEqual(kubectlCalls, []);
  const info = plugin.execInfo();
  assert.equal(info.kind, "ExecCredential");
  assert.equal(info.spec.interactive, false);
  assert.equal(info.spec.cluster.server, `https://127.0.0.1:${server.port}`, "provideClusterInfo hands over the cluster");
});

test("a 401 drops the plugin's credential and the request is retried once with a new one", async (t) => {
  const server = await tlsServer(t, (request, response) => {
    if (request.headers.authorization === "Bearer fresh") json(response, 200, { ok: true });
    else json(response, 401, { kind: "Status", reason: "Unauthorized" });
  });
  const dir = tempDir(t);
  const plugin = execPlugin(dir, { tokens: ["stale", "fresh"] });
  const kubeconfig = writeKubeconfig(dir, { server: `https://127.0.0.1:${server.port}`, cluster: { "certificate-authority-data": b64(pem("ca.crt")) }, user: { exec: plugin.exec } });
  const { runner } = setup(t);
  assert.deepEqual(await runner.runJson(rawCommand(kubeconfig, "/api")), { ok: true });
  assert.equal(plugin.runs(), 2);
});

test("an exec plugin that fails leaves the request to kubectl", async (t) => {
  const dir = tempDir(t);
  const kubeconfig = writeKubeconfig(dir, {
    server: "https://127.0.0.1:1",
    user: { exec: { apiVersion: "client.authentication.k8s.io/v1", command: process.execPath, args: ["-e", "process.exit(3)"] } },
  });
  const { runner, kubectlCalls } = setup(t);
  assert.deepEqual(await runner.runJson(rawCommand(kubeconfig, "/api")), { from: "kubectl" });
  assert.equal(kubectlCalls.length, 1);
});

test("an expiring credential is replaced before it expires", async () => {
  let now = 1_000_000;
  let runs = 0;
  const cache = new ExecCredentialCache(
    () => {},
    () => now,
    async () => ({ token: `t${++runs}`, cert: null, key: null, expiresAt: now + 60_000 }),
  );
  const exec = { apiVersion: "client.authentication.k8s.io/v1", command: "x", args: [], env: [], provideClusterInfo: false, kubeconfigDir: "/" };
  assert.equal((await cache.get(exec, { server: "s" }, {})).token, "t1");
  now += 20_000;
  assert.equal((await cache.get(exec, { server: "s" }, {})).token, "t1");
  now += 15_000;
  assert.equal((await cache.get(exec, { server: "s" }, {})).token, "t2", "within 30 s of expiry it is renewed");
});

test("a rewritten kubeconfig is read again", async (t) => {
  const dir = tempDir(t);
  const kubeconfig = writeKubeconfig(dir, { server: "https://127.0.0.1:1", user: { token: "one" } });
  assert.equal(connectionProfile(kubeconfig).profile.token, "one");
  const doc = JSON.parse(fs.readFileSync(kubeconfig, "utf8"));
  doc.users[0].user.token = "second";
  fs.writeFileSync(kubeconfig, JSON.stringify(doc));
  assert.equal(connectionProfile(kubeconfig).profile.token, "second");
});
