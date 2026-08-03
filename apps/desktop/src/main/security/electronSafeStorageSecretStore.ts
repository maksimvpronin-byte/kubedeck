import { safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { SecretName, SecretStore } from "../backend/security/secretStore";

function secureWrite(filePath: string, data: Buffer): void {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") fs.chmodSync(directory, 0o700);
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, data, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
  if (process.platform !== "win32") fs.chmodSync(filePath, 0o600);
}

export class ElectronSafeStorageSecretStore implements SecretStore {
  private readonly directory: string;

  constructor(appDataRoot: string) {
    this.directory = path.join(appDataRoot, "secrets");
  }

  isAvailable(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  private file(name: SecretName): string {
    return path.join(this.directory, `${name}.bin`);
  }

  has(name: SecretName): boolean {
    return fs.existsSync(this.file(name));
  }

  read(name: SecretName): string {
    if (!this.isAvailable() || !this.has(name)) return "";
    return safeStorage.decryptString(fs.readFileSync(this.file(name)));
  }

  write(name: SecretName, value: string): void {
    if (!this.isAvailable()) {
      throw new Error("System secret storage is unavailable");
    }
    secureWrite(this.file(name), safeStorage.encryptString(value));
    if (this.read(name) !== value) {
      throw new Error("Encrypted secret verification failed");
    }
  }

  delete(name: SecretName): void {
    fs.rmSync(this.file(name), { force: true });
  }
}
