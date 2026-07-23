import { X } from "lucide-react";
import type { ResourceWorkspaceTab } from "../utils/workspaceTabs";

export function ResourceWorkspaceTabs({
  tabs,
  activeId,
  onActivate,
  onClose,
}: {
  tabs: ResourceWorkspaceTab[];
  activeId: string | null;
  onActivate: (tab: ResourceWorkspaceTab) => void;
  onClose: (id: string) => void;
}) {
  return (
    <div className="resource-workspace-tabs" role="tablist" aria-label="Open resources">
      {tabs.map((tab) => (
        <div
          className={`resource-workspace-tab ${tab.id === activeId ? "active" : ""}`}
          role="tab"
          aria-selected={tab.id === activeId}
          key={tab.id}
          title={`${tab.clusterName} · ${tab.resource} · ${tab.namespace}/${tab.row.name}`}
        >
          <button type="button" onClick={() => onActivate(tab)}>
            <strong>{tab.row.name}</strong>
            <small>
              {tab.namespace !== "_cluster" ? `· ${tab.namespace}` : "· cluster"}
              {tab.status && tab.status !== "ready" ? ` · ${tab.status}` : ""}
            </small>
          </button>
          <button
            type="button"
            className="resource-workspace-tab-close"
            onClick={() => onClose(tab.id)}
            title="Close resource tab"
            data-tooltip="Close resource tab"
            aria-label={`Close ${tab.row.name}`}
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
