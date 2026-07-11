import type { ResourceRow } from "../types";
import { eventInvolvedLocator } from "./eventResourceLocator";

type NodeAction = "cordon" | "uncordon" | "drain";

export function createNodeBulkActions(resource: string, request: (action: NodeAction, rows: ResourceRow[]) => Promise<void>) {
  if (resource !== "nodes") return {};
  return {
    onBulkCordon: (rows: ResourceRow[]) => void request("cordon", rows),
    onBulkUncordon: (rows: ResourceRow[]) => void request("uncordon", rows),
    onBulkDrain: (rows: ResourceRow[]) => void request("drain", rows),
  };
}

export function openResourceTableRow(resource: string, row: ResourceRow, openLocator: (row: ResourceRow) => Promise<void>, select: (row: ResourceRow, resource: string) => void): void {
  if (resource === "events") {
    const involved = eventInvolvedLocator(row);
    if (involved) {
      void openLocator(involved);
      return;
    }
  }
  select(row, resource);
}
