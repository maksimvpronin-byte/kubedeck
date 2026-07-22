import type { Column } from "./ResourceTable";
import { ResourceTable } from "./ResourceTable";
import type { ResourceRow } from "../types";
import { createResourceTableLabels } from "../utils/resourceTableLabels";
import { createNodeBulkActions, openResourceTableRow } from "../utils/resourceTableActions";
import { refreshActionLabels } from "./AsyncActionButton";

interface Props {
  title: string;
  resource: string;
  rows: ResourceRow[];
  columns: Column[];
  loading: boolean;
  selectedRow: ResourceRow | null;
  canBulkDelete: boolean;
  t: (key: string) => string;
  onRefresh: () => void | boolean | Promise<void | boolean>;
  onOpenLocator: (row: ResourceRow) => Promise<void>;
  onSelect: (row: ResourceRow, resource: string) => void;
  onPin: (row: ResourceRow, resource: string) => void;
  onNamespaceClick: (namespace: string) => void;
  onBulkDelete: (resource: string, rows: ResourceRow[]) => void;
  onNodeAction: (action: "cordon" | "uncordon" | "drain", rows: ResourceRow[]) => Promise<void>;
}

export function AppResourceTable(props: Props) {
  return (
    <ResourceTable
      title={props.title}
      rows={props.rows}
      columns={props.columns}
      loading={props.loading}
      onRefresh={props.onRefresh}
      {...createNodeBulkActions(props.resource, props.onNodeAction)}
      onOpen={(row) => openResourceTableRow(props.resource, row, props.onOpenLocator, props.onSelect)}
      onPin={(row) => props.onPin(row, props.resource)}
      selectedRow={props.selectedRow}
      onNamespaceClick={props.onNamespaceClick}
      onBulkDelete={props.canBulkDelete ? (rows) => props.onBulkDelete(props.resource, rows) : undefined}
      filterLabel={props.t("resources.filter")}
      refreshLabel={props.t("resources.refresh")}
      refreshActionLabels={refreshActionLabels(props.t)}
      labels={createResourceTableLabels(props.t)}
      stateKey={props.resource}
    />
  );
}
