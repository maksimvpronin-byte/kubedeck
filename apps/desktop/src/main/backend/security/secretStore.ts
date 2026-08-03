export type SecretName = "llm-api-key";

export interface SecretStore {
  isAvailable(): boolean;
  has(name: SecretName): boolean;
  read(name: SecretName): string;
  write(name: SecretName, value: string): void;
  delete(name: SecretName): void;
}
