export interface ResourceChangedEvent {
  type: "resource.changed";
  clusterId: string;
  watchId: string;
  resource: string;
  namespace: string;
  name: string;
  eventType: string;
  cacheInvalidations: number;
  at: number;
}

// A kubectl watch that ended without being asked to. The socket that carried
// its events stays open - the heartbeat keeps it alive - so without this the
// renderer would go on trusting a watch nobody is reading and leave polling
// off. `namespace` is the scope of the watch ("all", "_cluster" or one
// namespace), not the namespace of an object.
export interface WatchEndedEvent {
  type: "watch.ended";
  clusterId: string;
  watchId: string;
  resource: string;
  namespace: string;
  status: "stopped" | "failed";
  exitCode: number | null;
  at: number;
}

export type ResourceWatchEvent = ResourceChangedEvent | WatchEndedEvent;

type UnpublishedEvent<E> = E extends ResourceWatchEvent ? Omit<E, "at"> & Partial<Pick<E, "at">> : never;

export interface ResourceWatchFilter {
  clusterId: string;
  resource: string;
  namespace: string;
}

export type ResourceWatchListener = (event: ResourceWatchEvent) => void;

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function resourceWatchEventMatches(event: ResourceWatchEvent, filter: ResourceWatchFilter): boolean {
  if (event.clusterId !== filter.clusterId) return false;
  if (normalize(event.resource) !== normalize(filter.resource)) return false;
  // The end of a watch concerns the socket of that same scope only: an
  // all-namespaces watch dying says nothing about a running `-n default` one.
  if (event.type === "watch.ended") return event.namespace === filter.namespace;
  if (filter.namespace === "all") return true;
  if (filter.namespace === "_cluster") return event.namespace === "_cluster";
  return event.namespace === filter.namespace;
}

export class ResourceWatchEventHub {
  private readonly listeners = new Set<ResourceWatchListener>();
  // The scope each subscriber listens to, for those that said.
  private readonly filters = new Map<ResourceWatchListener, ResourceWatchFilter>();

  publish(event: UnpublishedEvent<ResourceWatchEvent>): ResourceWatchEvent {
    const published = {
      ...event,
      at: typeof event.at === "number" ? event.at : Date.now() / 1000,
    } as ResourceWatchEvent;
    for (const listener of [...this.listeners]) {
      listener(published);
    }
    return published;
  }

  subscribe(listener: ResourceWatchListener, filter?: ResourceWatchFilter): () => void {
    this.listeners.add(listener);
    if (filter) this.filters.set(listener, filter);
    return () => {
      this.listeners.delete(listener);
      this.filters.delete(listener);
    };
  }

  // Whether somebody listens to exactly this watch scope.
  hasSubscriber(scope: ResourceWatchFilter): boolean {
    for (const filter of this.filters.values()) {
      if (filter.clusterId === scope.clusterId && normalize(filter.resource) === normalize(scope.resource) && filter.namespace === scope.namespace) return true;
    }
    return false;
  }

  subscriberCount(): number {
    return this.listeners.size;
  }

  clear(): void {
    this.listeners.clear();
    this.filters.clear();
  }
}
