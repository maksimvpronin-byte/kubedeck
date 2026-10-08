// One resource scope kept in memory and current: a LIST, then a WATCH from the
// list's resourceVersion over the cluster's kept connection.
//
// The kubectl watch this replaces only said "something changed"; every event
// sent the table back to the API server for the whole list again. On a busy
// cluster - Argo CD Applications rewrite their status every few minutes, pods
// churn all day - that was a list of megabytes per second or two. Here the
// list is read once, every event is applied to the copy, and the table's
// reload is answered from memory.

import type { IncomingMessage } from "node:http";
import { KubectlError } from "../kubectl/errors";
import type { ClusterApi } from "../api/clusterApi";

const LIST_TIMEOUT_SECONDS = 60;
const LIST_MAX_BYTES = 256 * 1024 * 1024;
// The server ends a watch after this long and it is resumed from the last
// resourceVersion; a little jitter keeps many informers from renewing at once.
const WATCH_TIMEOUT_SECONDS = 290;
// Retrying a lost connection, one step further each time in a row.
const RETRY_DELAYS_MS = [1000, 2000, 5000, 10_000, 30_000];
const MAX_EVENT_LINE_BYTES = 64 * 1024 * 1024;

export interface InformerChange {
  eventType: string;
  namespace: string;
  name: string;
}

export interface InformerCallbacks {
  // One object changed.
  changed(change: InformerChange): void;
  // The copy was rebuilt from a new list; whatever changed meanwhile is in it.
  resynced(): void;
  // The informer cannot go on (refused, or the type went away). It is stopped.
  failed(error: KubectlError): void;
}

type JsonObject = Record<string, unknown>;

function record(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function objectKey(object: JsonObject): string {
  const metadata = record(object.metadata);
  const namespace = typeof metadata.namespace === "string" ? metadata.namespace : "";
  const name = typeof metadata.name === "string" ? metadata.name : "";
  return `${namespace}/${name}`;
}

// Refusals that retrying will not fix.
function isPermanent(error: unknown): boolean {
  if (!(error instanceof KubectlError)) return false;
  return ["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"].includes(error.info.code);
}

class GoneError extends Error {}

// A watch the server ended this soon is not a normal renewal, and resuming
// at once would spin.
const MIN_WATCH_MS = 1000;

function isGone(error: unknown): boolean {
  return error instanceof GoneError || (error instanceof KubectlError && error.info.rawStderr.includes("(Gone)"));
}

export class ApiInformer {
  private readonly objects = new Map<string, JsonObject>();
  private resourceVersion = "";
  private listKind = "";
  private listApiVersion = "";
  private syncedFlag = false;
  private stopped = false;
  private failures = 0;
  private controller = new AbortController();
  private retryTimer: NodeJS.Timeout | undefined;
  private initial: { resolve: () => void; reject: (error: unknown) => void } | null = null;
  eventsSeen = 0;
  relists = 0;

  constructor(
    private readonly api: ClusterApi,
    private readonly listPath: string,
    private readonly callbacks: InformerCallbacks,
    private readonly log: (message: string) => void,
  ) {}

  get preview(): string {
    return `GET ${this.api.url(this.watchPath("<rv>")).href}`;
  }

  // Resolves once the first list is in; rejects with that list's failure.
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.initial = { resolve, reject };
      void this.run();
    });
  }

  get synced(): boolean {
    return this.syncedFlag && !this.stopped;
  }

  // The current objects as a list `kubectl get -o json` would give, items typed.
  snapshot(namespace?: string): JsonObject {
    const items: JsonObject[] = [];
    for (const object of this.objects.values()) {
      if (namespace && record(object.metadata).namespace !== namespace) continue;
      items.push(object);
    }
    return { kind: this.listKind || "List", apiVersion: this.listApiVersion, metadata: { resourceVersion: this.resourceVersion }, items };
  }

  get size(): number {
    return this.objects.size;
  }

  private wake: (() => void) | null = null;

  stop(): void {
    this.stopped = true;
    this.syncedFlag = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.wake?.();
    this.controller.abort();
    this.objects.clear();
  }

  private watchPath(resourceVersion: string): string {
    const separator = this.listPath.includes("?") ? "&" : "?";
    const timeout = WATCH_TIMEOUT_SECONDS + Math.floor(Math.random() * 30);
    return `${this.listPath}${separator}watch=1&allowWatchBookmarks=true&resourceVersion=${encodeURIComponent(resourceVersion)}&timeoutSeconds=${timeout}`;
  }

  // Typed like a `kubectl get -o json` item, and without managedFields: often
  // half of an object, held for as long as the watch runs, read by nothing a
  // table shows (the YAML view reads the object from the server itself).
  private typed(object: JsonObject): JsonObject {
    const metadata = record(object.metadata);
    if ("managedFields" in metadata) delete metadata.managedFields;
    if (this.listKind.endsWith("List") && !object.kind) object.kind = this.listKind.slice(0, -"List".length);
    if (this.listApiVersion && !object.apiVersion) object.apiVersion = this.listApiVersion;
    return object;
  }

  private async list(): Promise<void> {
    const preview = `GET ${this.api.url(this.listPath).href}`;
    const body = await this.api.get(this.listPath, { timeoutSeconds: LIST_TIMEOUT_SECONDS, maxBytes: LIST_MAX_BYTES, signal: this.controller.signal, preview });
    const list = record(JSON.parse(body));
    this.listKind = typeof list.kind === "string" ? list.kind : "";
    this.listApiVersion = typeof list.apiVersion === "string" ? list.apiVersion : "";
    this.resourceVersion = String(record(list.metadata).resourceVersion ?? "");
    this.objects.clear();
    for (const item of Array.isArray(list.items) ? list.items : []) {
      const object = this.typed(record(item));
      this.objects.set(objectKey(object), object);
    }
    this.syncedFlag = true;
  }

  // Applies events until the server ends the watch. Resolves on a normal end;
  // throws GoneError when the resourceVersion is too old to resume from.
  private async watch(): Promise<void> {
    const path = this.watchPath(this.resourceVersion);
    const response: IncomingMessage = await this.api.stream(path, { signal: this.controller.signal, preview: `GET ${this.api.url(path).href}` });
    await new Promise<void>((resolve, reject) => {
      let buffered = "";
      let failed = false;
      const fail = (error: Error) => {
        if (failed) return;
        failed = true;
        response.destroy();
        reject(error);
      };
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        buffered += chunk;
        if (buffered.length > MAX_EVENT_LINE_BYTES) {
          fail(new Error("watch event is too large"));
          return;
        }
        let newline = buffered.indexOf("\n");
        while (newline >= 0 && !failed) {
          const line = buffered.slice(0, newline).trim();
          buffered = buffered.slice(newline + 1);
          if (line) {
            try {
              this.apply(JSON.parse(line));
            } catch (error) {
              fail(error instanceof Error ? error : new Error(String(error)));
              return;
            }
          }
          newline = buffered.indexOf("\n");
        }
      });
      response.once("end", () => {
        if (!failed) resolve();
      });
      response.once("error", (error) => fail(error));
      response.once("close", () => {
        if (!failed) resolve();
      });
    });
  }

  private apply(value: unknown): void {
    const event = record(value);
    const type = typeof event.type === "string" ? event.type : "";
    const object = record(event.object);
    if (type === "ERROR") {
      const code = Number(object.code);
      if (code === 410) throw new GoneError("resourceVersion too old");
      throw new Error(`watch error: ${typeof object.message === "string" ? object.message : code}`);
    }
    const resourceVersion = record(object.metadata).resourceVersion;
    if (typeof resourceVersion === "string" && resourceVersion) this.resourceVersion = resourceVersion;
    if (type === "BOOKMARK") return;
    const key = objectKey(object);
    if (type === "DELETED") this.objects.delete(key);
    else if (type === "ADDED" || type === "MODIFIED") this.objects.set(key, this.typed(object));
    else return;
    this.eventsSeen += 1;
    const metadata = record(object.metadata);
    this.callbacks.changed({
      eventType: type,
      namespace: typeof metadata.namespace === "string" && metadata.namespace ? metadata.namespace : "_cluster",
      name: typeof metadata.name === "string" ? metadata.name : "",
    });
  }

  private async run(): Promise<void> {
    let needList = true;
    while (!this.stopped) {
      try {
        if (needList) {
          const first = this.initial !== null;
          await this.list();
          if (this.initial) {
            this.initial.resolve();
            this.initial = null;
          }
          if (!first) {
            this.relists += 1;
            this.callbacks.resynced();
          }
          needList = false;
        }
        const watchStarted = Date.now();
        await this.watch();
        // A watch the server ended resumes where it left off - after a pause
        // when it ended at once, so a server that keeps doing that is not
        // asked again in a tight loop.
        if (Date.now() - watchStarted < MIN_WATCH_MS) await this.pause();
        else this.failures = 0;
      } catch (error) {
        if (this.stopped) return;
        if (this.initial) {
          this.initial.reject(error);
          this.initial = null;
          this.stop();
          return;
        }
        if (isGone(error)) {
          // Events were compacted away: the copy is rebuilt from a new list.
          needList = true;
          continue;
        }
        if (isPermanent(error)) {
          this.log(`node api watch ${this.listPath} refused: ${(error as KubectlError).info.code}`);
          this.stop();
          this.callbacks.failed(error as KubectlError);
          return;
        }
        // Lost connection: the copy can no longer be trusted until relisted.
        this.syncedFlag = false;
        needList = true;
        this.log(`node api watch ${this.listPath} lost (${error instanceof Error ? error.message : String(error)}), relisting`);
        await this.pause();
      }
    }
  }

  // Waits one step longer each time in a row; stop() cuts it short.
  private async pause(): Promise<void> {
    const delay = RETRY_DELAYS_MS[Math.min(this.failures, RETRY_DELAYS_MS.length - 1)];
    this.failures += 1;
    await new Promise<void>((resolve) => {
      this.wake = resolve;
      this.retryTimer = setTimeout(resolve, delay);
    });
    this.wake = null;
  }
}
