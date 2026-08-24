// One implementation of the two quantity formats KubeDeck prints: CPU as cores
// or millicores, and memory or disk on the binary ladder. Both processes import
// it - the main process compiles it into dist/shared, the renderer bundles it -
// because before this there were eight copies with four different rounding
// rules, and the same node could read 31.4Gi in one place and 31.39 GiB in
// another.

export type ByteUnit = "B" | "KiB" | "MiB" | "GiB" | "TiB";

const BYTE_LADDER: Array<[ByteUnit, number]> = [
  ["TiB", 1024 ** 4],
  ["GiB", 1024 ** 3],
  ["MiB", 1024 ** 2],
  ["KiB", 1024],
  ["B", 1],
];

export interface QuantityFormat {
  /** Maximum decimals; trailing zeros are dropped. Default 2. */
  digits?: number;
  /** Printed instead of a number that is not finite. Default "". */
  fallback?: string;
  /**
   * Thousands separators. Off by default, and it has to stay off wherever the
   * result travels as data: `resources/metrics.ts` and `resources/normalizers`
   * format node capacity into row fields that the renderer parses back to work
   * out a percentage, and a separator would not parse.
   */
  group?: boolean;
  /**
   * Always print `digits` decimals instead of dropping trailing zeros, so a
   * column reads 8.00 GiB above 31.38 GiB with the points under each other.
   */
  fixed?: boolean;
}

function round(value: number, { digits = 2, group = false, fixed = false }: QuantityFormat): string {
  if (group) return new Intl.NumberFormat(undefined, { maximumFractionDigits: digits, minimumFractionDigits: fixed ? digits : 0 }).format(value);
  if (fixed) return value.toFixed(digits);
  const factor = 10 ** digits;
  return String(Math.round(value * factor) / factor);
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Millicores in, `1.5 cores` or `250m` out. */
export function formatCpuMillicores(value: unknown, options: QuantityFormat = {}): string {
  const millicores = finite(value);
  if (millicores === null) return options.fallback ?? "";
  if (millicores >= 1000) {
    const cores = round(millicores / 1000, options);
    // Eight copies of this all printed "1 cores"; there is one place to fix now.
    return `${cores} ${cores === "1" ? "core" : "cores"}`;
  }
  return `${round(millicores, { ...options, digits: options.digits ?? 1 })}m`;
}

/** Bytes in, the largest unit that leaves a number ≥ 1 out. */
export function formatBytes(value: unknown, options: QuantityFormat = {}): string {
  const bytes = finite(value);
  if (bytes === null) return options.fallback ?? "";
  const [unit, divisor] = BYTE_LADDER.find(([, threshold]) => bytes >= threshold) ?? ["B", 1];
  return `${round(bytes / divisor, options)} ${unit}`;
}

// Kubernetes quantity notation - `1500m`, `403840Ki` - rather than the display
// format above. This is what `kubectl top` prints, and what the sampler stores,
// so a reading and the limit beside it in the same bar have to use it together:
// "403840Ki used · 1.5 cores limit" is one bar written two ways.

/** Millicores in, `2` or `1500m` out. */
export function formatCpuNotation(value: unknown, options: QuantityFormat = {}): string {
  const millicores = finite(value);
  if (millicores === null) return options.fallback ?? "";
  if (millicores === 0) return "0m";
  return millicores % 1000 === 0 ? String(millicores / 1000) : `${millicores}m`;
}

/** Bytes in, `1.5Gi` or `403840Ki` out. */
export function formatMemoryNotation(value: unknown, options: QuantityFormat = {}): string {
  const bytes = finite(value);
  if (bytes === null) return options.fallback ?? "";
  if (bytes === 0) return "0Mi";

  // Magnitude picks the unit, exactness only picks the decimals. Choosing the
  // unit by exact division instead left 403840Ki as "403840Ki" - it divides by
  // 1024 evenly, so Ki won over the Mi that a reader actually wants.
  for (const [suffix, multiplier] of [
    ["Gi", 1024 ** 3],
    ["Mi", 1024 ** 2],
    ["Ki", 1024],
  ] as const) {
    if (bytes < multiplier) continue;
    const scaled = bytes / multiplier;
    return `${bytes % multiplier === 0 ? scaled : Math.round(scaled * 10) / 10}${suffix}`;
  }
  return `${bytes}B`;
}

/**
 * Bytes in, always the unit asked for. A column whose rows must be comparable
 * at a glance cannot mix MiB and GiB down its length.
 */
export function formatBytesIn(value: unknown, unit: ByteUnit, options: QuantityFormat = {}): string {
  const bytes = finite(value);
  if (bytes === null) return options.fallback ?? "";
  const divisor = BYTE_LADDER.find(([candidate]) => candidate === unit)?.[1] ?? 1;
  return `${round(bytes / divisor, options)} ${unit}`;
}
