// Every cluster the user has opened leaves background work behind it: a usage
// sampler polling on a timer and one kubectl watch process per resource kind
// being viewed. Nothing used to stop that when the user moved on, so a session
// spent across eight clusters ended with eight samplers and eight sets of watch
// processes still running against clusters nobody was looking at.
//
// This registry is the switch. A cluster is connected only while KubeDeck is
// allowed to talk to it on its own; disconnecting releases the runtime and
// keeps it released, so a stray list load cannot quietly revive it.
export class ClusterConnectionRegistry {
  private readonly connected = new Set<string>();

  connect(clusterId: string): void {
    if (clusterId) this.connected.add(clusterId);
  }

  disconnect(clusterId: string): void {
    this.connected.delete(clusterId);
  }

  isConnected(clusterId: string): boolean {
    return this.connected.has(clusterId);
  }

  list(): string[] {
    return [...this.connected];
  }

  // Removing a cluster takes its connection state with it, so re-importing the
  // same kubeconfig does not come back pre-connected.
  forget(clusterId: string): void {
    this.disconnect(clusterId);
  }
}
