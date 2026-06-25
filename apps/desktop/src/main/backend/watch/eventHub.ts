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

export interface ResourceWatchFilter {
  clusterId: string;
  resource: string;
  namespace: string;
}

export type ResourceWatchListener = (event: ResourceChangedEvent) => void;

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function resourceWatchEventMatches(
  event: ResourceChangedEvent,
  filter: ResourceWatchFilter,
): boolean {
  if (event.clusterId !== filter.clusterId) return false;
  if (normalize(event.resource) !== normalize(filter.resource)) return false;
  if (filter.namespace === "all") return true;
  if (filter.namespace === "_cluster") return event.namespace === "_cluster";
  return event.namespace === filter.namespace;
}

export class ResourceWatchEventHub {
  private readonly listeners = new Set<ResourceWatchListener>();

  publish(
    event: Omit<ResourceChangedEvent, "at"> & Partial<Pick<ResourceChangedEvent, "at">>,
  ): ResourceChangedEvent {
    const published: ResourceChangedEvent = {
      ...event,
      at: typeof event.at === "number" ? event.at : Date.now() / 1000,
    };
    for (const listener of [...this.listeners]) {
      listener(published);
    }
    return published;
  }

  subscribe(listener: ResourceWatchListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscriberCount(): number {
    return this.listeners.size;
  }

  clear(): void {
    this.listeners.clear();
  }
}
