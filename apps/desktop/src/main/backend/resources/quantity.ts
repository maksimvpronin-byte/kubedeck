export function parseCpuMillicores(value: unknown): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  let parsed: number;
  if (raw.endsWith("m")) parsed = Number(raw.slice(0, -1));
  else if (raw.endsWith("u")) parsed = Number(raw.slice(0, -1)) / 1000;
  else if (raw.endsWith("n")) parsed = Number(raw.slice(0, -1)) / 1_000_000;
  else parsed = Number(raw) * 1000;

  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

export function parseMemoryBytes(value: unknown): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const units: Array<[string, number]> = [
    ["Ki", 1024],
    ["Mi", 1024 ** 2],
    ["Gi", 1024 ** 3],
    ["Ti", 1024 ** 4],
    ["Pi", 1024 ** 5],
    ["Ei", 1024 ** 6],
    ["K", 1000],
    ["M", 1000 ** 2],
    ["G", 1000 ** 3],
    ["T", 1000 ** 4],
    ["P", 1000 ** 5],
    ["E", 1000 ** 6],
  ];

  for (const [suffix, multiplier] of units) {
    if (raw.endsWith(suffix)) {
      const parsed = Number(raw.slice(0, -suffix.length));
      return Number.isFinite(parsed) ? Math.trunc(parsed * multiplier) : null;
    }
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}
