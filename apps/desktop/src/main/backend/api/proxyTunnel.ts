// Agents that reach the API server through an HTTP proxy's CONNECT tunnel.
//
// Node has built-in proxy support only from 24.5 and only for proxies named in
// environment variables, and the tests run on Node 22. A tunnel is a few dozen
// lines, so it is done here once and behaves the same everywhere.

import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { Duplex } from "node:stream";
import tls from "node:tls";

const CONNECT_TIMEOUT_MS = 30_000;
const MAX_CONNECT_RESPONSE_BYTES = 16 * 1024;

type ConnectCallback = (error: Error | null, socket?: Duplex) => void;

function tunnelError(message: string): Error {
  return Object.assign(new Error(message), { code: "ERR_PROXY_TUNNEL" });
}

// Opens a CONNECT tunnel to host:port through `proxy`.
function openTunnel(proxy: URL, host: string, port: number, callback: (error: Error | null, socket?: net.Socket | tls.TLSSocket) => void): void {
  const proxyPort = Number(proxy.port) || (proxy.protocol === "https:" ? 443 : 80);
  const socket: net.Socket | tls.TLSSocket =
    proxy.protocol === "https:" ? tls.connect({ host: proxy.hostname, port: proxyPort, servername: net.isIP(proxy.hostname) ? undefined : proxy.hostname }) : net.connect(proxyPort, proxy.hostname);
  let settled = false;
  const finish = (error: Error | null) => {
    if (settled) return;
    settled = true;
    socket.setTimeout(0);
    socket.removeListener("data", onData);
    if (error) {
      socket.destroy();
      callback(error);
    } else callback(null, socket);
  };
  let received = Buffer.alloc(0);
  const onData = (chunk: Buffer) => {
    received = Buffer.concat([received, chunk]);
    const end = received.indexOf("\r\n\r\n");
    if (end < 0) {
      if (received.length > MAX_CONNECT_RESPONSE_BYTES) finish(tunnelError("proxy answer to CONNECT is too large"));
      return;
    }
    const statusLine = received.subarray(0, received.indexOf("\r\n")).toString("latin1");
    const status = Number(statusLine.split(" ")[1]);
    if (status !== 200) {
      finish(tunnelError(`proxy refused CONNECT to ${host}:${port}: ${statusLine}`));
      return;
    }
    // Anything after the headers already belongs to the tunnelled stream.
    const rest = received.subarray(end + 4);
    if (rest.length) socket.unshift(rest);
    finish(null);
  };
  socket.on("data", onData);
  socket.once("error", (error) => finish(Object.assign(tunnelError(`proxy ${proxy.host}: ${error.message}`), { cause: error })));
  socket.setTimeout(CONNECT_TIMEOUT_MS, () => finish(tunnelError(`proxy ${proxy.host} did not answer CONNECT`)));
  socket.once(proxy.protocol === "https:" ? "secureConnect" : "connect", () => {
    const authority = net.isIPv6(host) ? `[${host}]:${port}` : `${host}:${port}`;
    const lines = [`CONNECT ${authority} HTTP/1.1`, `Host: ${authority}`];
    if (proxy.username || proxy.password) {
      const credentials = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
      lines.push(`Proxy-Authorization: Basic ${Buffer.from(credentials).toString("base64")}`);
    }
    socket.write(`${lines.join("\r\n")}\r\n\r\n`);
  });
}

export class TunnelingHttpsAgent extends https.Agent {
  constructor(
    private readonly proxy: URL,
    options: https.AgentOptions,
  ) {
    super(options);
  }

  createConnection(options: tls.ConnectionOptions & { host?: string; port?: number }, callback: ConnectCallback): undefined {
    const host = options.host ?? "localhost";
    const port = Number(options.port) || 443;
    openTunnel(this.proxy, host, port, (error, socket) => {
      if (error || !socket) {
        callback(error ?? tunnelError("proxy tunnel failed"));
        return;
      }
      const secure = tls.connect({ ...options, socket });
      callback(null, secure);
    });
    return undefined;
  }
}

export class TunnelingHttpAgent extends http.Agent {
  constructor(
    private readonly proxy: URL,
    options: http.AgentOptions,
  ) {
    super(options);
  }

  createConnection(options: net.NetConnectOpts & { host?: string; port?: number }, callback: ConnectCallback): undefined {
    openTunnel(this.proxy, options.host ?? "localhost", Number(options.port) || 80, (error, socket) => {
      if (error || !socket) callback(error ?? tunnelError("proxy tunnel failed"));
      else callback(null, socket);
    });
    return undefined;
  }
}
