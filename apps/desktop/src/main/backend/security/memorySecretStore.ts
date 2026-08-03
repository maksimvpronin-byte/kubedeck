import type { SecretName, SecretStore } from "./secretStore";

export class MemorySecretStore implements SecretStore {
  private readonly values = new Map<SecretName, string>();

  constructor(private readonly available = true) {}

  isAvailable(): boolean {
    return this.available;
  }

  has(name: SecretName): boolean {
    return this.values.has(name);
  }

  read(name: SecretName): string {
    return this.values.get(name) ?? "";
  }

  write(name: SecretName, value: string): void {
    if (!this.available) {
      throw new Error("System secret storage is unavailable");
    }
    this.values.set(name, value);
  }

  delete(name: SecretName): void {
    this.values.delete(name);
  }
}
