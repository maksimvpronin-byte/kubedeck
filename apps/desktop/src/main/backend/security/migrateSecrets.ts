import fs from "node:fs";
import path from "node:path";
import type { SecretStore } from "./secretStore";

export interface SecretMigrationResult {
  migrated: boolean;
  blocked: boolean;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function secureRewrite(filePath: string, value: unknown): void {
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(temporary, filePath);
  if (process.platform !== "win32") fs.chmodSync(filePath, 0o600);
}

function extractSecret(value: unknown): string {
  const llm = record(record(record(value)?.settings)?.llm);
  const apiKey = typeof llm?.apiKey === "string" ? llm.apiKey.trim() : "";
  return apiKey;
}

function scrubSecret(value: unknown): unknown {
  const llm = record(record(record(value)?.settings)?.llm);
  if (!llm) return value;
  const hadSecret = typeof llm.apiKey === "string" && llm.apiKey.trim().length > 0;
  delete llm.apiKey;
  llm.apiKeyConfigured = Boolean(hadSecret || llm.apiKeyConfigured);
  return value;
}

function knownFiles(appDataRoot: string): string[] {
  const files = ["config.json", "config.backup.json", "config.broken.json"].map((name) => path.join(appDataRoot, name));
  const tempPattern = /^config\.json\.\d+\.\d+\.tmp$/;
  if (fs.existsSync(appDataRoot)) {
    for (const name of fs.readdirSync(appDataRoot)) {
      if (tempPattern.test(name)) files.push(path.join(appDataRoot, name));
    }
  }
  return files;
}

export function migratePlaintextLlmSecret(appDataRoot: string, secretStore: SecretStore): SecretMigrationResult {
  const marker = path.join(appDataRoot, "secrets", "migration-v1.json");
  if (fs.existsSync(marker)) {
    return { migrated: false, blocked: false };
  }

  let plaintext = "";
  const parsed: Array<{ filePath: string; value: unknown }> = [];
  for (const filePath of knownFiles(appDataRoot)) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (!plaintext) plaintext = extractSecret(value);
      parsed.push({ filePath, value });
    } catch {
      // Invalid recovery copies remain untouched; ConfigStore handles them on load.
    }
  }

  if (!plaintext) {
    fs.mkdirSync(path.dirname(marker), { recursive: true, mode: 0o700 });
    secureRewrite(marker, { version: 1, completedAt: new Date().toISOString() });
    return { migrated: false, blocked: false };
  }

  if (!secretStore.isAvailable()) {
    // Can't encrypt yet, but every plaintext copy on disk can still be
    // permission-hardened immediately instead of left world/user-readable.
    for (const item of parsed) {
      if (process.platform !== "win32") {
        try {
          fs.chmodSync(item.filePath, 0o600);
        } catch {
          // Best effort only.
        }
      }
    }
    return { migrated: false, blocked: true };
  }

  secretStore.write("llm-api-key", plaintext);
  for (const item of parsed) {
    secureRewrite(item.filePath, scrubSecret(item.value));
  }

  fs.mkdirSync(path.dirname(marker), { recursive: true, mode: 0o700 });
  secureRewrite(marker, { version: 1, completedAt: new Date().toISOString() });
  return { migrated: true, blocked: false };
}
