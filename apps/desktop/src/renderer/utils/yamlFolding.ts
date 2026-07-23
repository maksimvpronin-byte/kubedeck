import { isCollection, LineCounter, parseDocument, visit } from "yaml";

export type YamlFoldRegion = {
  path: string;
  label: string;
  depth: number;
  startLine: number;
  endLine: number;
  itemCount: number;
};

export function yamlFoldRegions(source: string): YamlFoldRegion[] {
  if (!source.trim()) return [];
  const lineCounter = new LineCounter();
  const document = parseDocument(source, { keepSourceTokens: true, lineCounter });
  if (document.errors.length) return [];
  const regions: YamlFoldRegion[] = [];

  visit(document, {
    Node(_key, node, path) {
      if (!isCollection(node) || !node.range || node.items.length === 0) return;
      if (path.length === 1) return;
      const parent = path.at(-1) as { key?: { value?: unknown; range?: [number, number, number?] } } | undefined;
      const start = lineCounter.linePos(parent?.key?.range ? parent.key.range[0] : node.range[0]).line;
      const end = lineCounter.linePos(Math.max(node.range[0], node.range[1] - 1)).line;
      if (end <= start) return;
      const label = String(parent?.key?.value ?? (path.length ? "item" : "document"));
      regions.push({
        path: `${path.map((part) => String((part as { key?: { value?: unknown } }).key?.value ?? "item")).join(".")}:${start}`,
        label,
        depth: path.filter((part) => Boolean((part as { key?: unknown }).key)).length,
        startLine: start,
        endLine: end,
        itemCount: node.items.length,
      });
    },
  });

  return regions.sort((left, right) => left.startLine - right.startLine || right.endLine - left.endLine);
}

export function visibleYamlLines(source: string, regions: YamlFoldRegion[], collapsed: ReadonlySet<string>) {
  const lines = source.split("\n");
  const byStart = new Map(regions.filter((region) => collapsed.has(region.path)).map((region) => [region.startLine, region]));
  const result: Array<{ line: string; lineNumber: number; region?: YamlFoldRegion; hiddenCount?: number }> = [];
  for (let lineNumber = 1; lineNumber <= lines.length; lineNumber += 1) {
    const region = byStart.get(lineNumber);
    result.push({ line: lines[lineNumber - 1] ?? "", lineNumber, region, hiddenCount: region ? region.endLine - region.startLine : undefined });
    if (region) lineNumber = region.endLine;
  }
  return result;
}
