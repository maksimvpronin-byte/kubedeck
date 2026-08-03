import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface KnownHostEntry {
  host: string;
  port: number;
  algorithm: string;
  fingerprint: string;
  rememberedAt: string;
}

interface StoredHost {
  algorithm: string;
  fingerprint: string;
  rememberedAt: string;
}

interface KnownHostsFile {
  version: 1;
  hosts: Record<string, StoredHost>;
}

const MAX_KNOWN_HOSTS = 2000;

/**
 * SHA256 fingerprint of a raw SSH public host key, formatted exactly like
 * OpenSSH prints it, so a user can compare it with `ssh-keyscan` output.
 */
export function sshSha256Fingerprint(key: Buffer): string {
  return `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
}

/**
 * Reads the algorithm name from an SSH public key blob. The blob starts with a
 * 4-byte big-endian length followed by the algorithm name, for example
 * `ssh-ed25519` or `ecdsa-sha2-nistp256`.
 */
export function sshKeyAlgorithm(key: Buffer): string {
  if (key.length < 4) return "unknown";
  const length = key.readUInt32BE(0);
  if (length < 1 || length > 64 || key.length < 4 + length) return "unknown";
  const name = key.subarray(4, 4 + length).toString("ascii");
  return /^[A-Za-z0-9@._-]+$/.test(name) ? name : "unknown";
}

/**
 * Normalizes a host into the key used by the store. Host names are
 * case-insensitive, IPv6 literals are stored without brackets and the port is
 * always part of the identity: the same name on another port is another host.
 */
export function canonicalSshHost(host: string, port: number): string {
  const normalized = host
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1");
  return `${normalized}:${port}`;
}

function splitCanonicalHost(key: string): { host: string; port: number } {
  const separator = key.lastIndexOf(":");
  if (separator <= 0) return { host: key, port: 22 };
  const port = Number(key.slice(separator + 1));
  return { host: key.slice(0, separator), port: Number.isInteger(port) ? port : 22 };
}

export class SshHostKeyStore {
  constructor(private readonly filePath: string) {}

  lookup(host: string, port: number): StoredHost | null {
    return this.load().hosts[canonicalSshHost(host, port)] ?? null;
  }

  list(): KnownHostEntry[] {
    return Object.entries(this.load().hosts)
      .map(([key, value]) => ({ ...splitCanonicalHost(key), algorithm: value.algorithm, fingerprint: value.fingerprint, rememberedAt: value.rememberedAt }))
      .sort((left, right) => left.host.localeCompare(right.host) || left.port - right.port);
  }

  remember(host: string, port: number, fingerprint: string, algorithm: string): void {
    const value = this.load();
    if (Object.keys(value.hosts).length >= MAX_KNOWN_HOSTS && !value.hosts[canonicalSshHost(host, port)]) {
      throw new Error("Known SSH host list is full");
    }
    value.hosts[canonicalSshHost(host, port)] = { algorithm, fingerprint, rememberedAt: new Date().toISOString() };
    this.save(value);
  }

  forget(host: string, port: number): boolean {
    const value = this.load();
    const key = canonicalSshHost(host, port);
    if (!value.hosts[key]) return false;
    delete value.hosts[key];
    this.save(value);
    return true;
  }

  private save(value: KnownHostsFile): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
    if (process.platform !== "win32") fs.chmodSync(this.filePath, 0o600);
  }

  private load(): KnownHostsFile {
    try {
      const value = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as KnownHostsFile;
      if (value?.version === 1 && value.hosts && typeof value.hosts === "object" && !Array.isArray(value.hosts)) return value;
    } catch {
      // A missing or damaged store is treated as empty: every host is then unknown
      // and requires explicit confirmation again. It is never silently trusted.
    }
    return { version: 1, hosts: {} };
  }
}
