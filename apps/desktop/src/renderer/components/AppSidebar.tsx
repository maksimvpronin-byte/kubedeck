import { ChevronDown, ChevronRight } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { brandIcon as Database, resourceLabel, resourceTree, sections } from "../navigation";
import type { Section } from "../types";
import type { CrdGroup } from "../utils/kubeResources";

interface Props {
  section: Section;
  resourceTab: string;
  expandedSections: Set<string>;
  expandedCrdGroups: Set<string>;
  crdGroups: CrdGroup[];
  t: (key: string) => string;
  onResizeStart: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onSelectSection: (section: Section) => void;
  onToggleSection: (section: Section) => void;
  onToggleCrdGroup: (group: string) => void;
  onSelectResource: (section: Section, resource: string) => void;
}

// The resource tree: one group per section, with the CRDs of a cluster grouped
// by API group underneath their own.
export function AppSidebar({ section, resourceTab, expandedSections, expandedCrdGroups, crdGroups, t, onResizeStart, onSelectSection, onToggleSection, onToggleCrdGroup, onSelectResource }: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-resize-handle" onMouseDown={onResizeStart} role="separator" aria-orientation="vertical" aria-label="Resize resource navigation" />
      <div className="brand">
        <Database size={22} />
        <strong>KubeDeck</strong>
      </div>
      <nav>
        {sections.map((item) => {
          const Icon = item.icon;
          const children = resourceTree[item.id] ?? [];
          const expanded = expandedSections.has(item.id);
          return (
            <div className="nav-group" key={item.id}>
              <button
                className={section === item.id || (item.id === "network" && section === "port-forwards") ? "active" : ""}
                onClick={() => (children.length ? onToggleSection(item.id) : onSelectSection(item.id))}
                aria-expanded={children.length ? expanded : undefined}
              >
                <Icon size={17} />
                {t(item.label)}
                {children.length ? <span className="nav-expander">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span> : null}
              </button>
              {item.id === "crd" && expanded ? (
                <div className="nav-children">
                  <button className={section === "crd" && resourceTab === "customresourcedefinitions" ? "active child" : "child"} onClick={() => onSelectResource("crd", "customresourcedefinitions")}>
                    {t("crd.definitions")}
                  </button>
                  {crdGroups.map((group) => (
                    <div className="nav-subgroup" key={group.group}>
                      <button className="nav-subgroup-header" onClick={() => onToggleCrdGroup(group.group)} title={group.group}>
                        {expandedCrdGroups.has(group.group) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        <span>{group.group}</span>
                      </button>
                      {expandedCrdGroups.has(group.group) ? (
                        <div className="nav-subgroup-items">
                          {group.items.map((crd) => (
                            <button
                              key={crd.resource}
                              className={section === "crd" && resourceTab === crd.resource ? "active child" : "child"}
                              onClick={() => onSelectResource("crd", crd.resource)}
                              title={`${crd.kind} (${crd.resource})`}
                            >
                              {crd.kind || crd.plural}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : children.length && expanded ? (
                <div className="nav-children">
                  {children.map((resource) => (
                    <button
                      key={`${item.id}-${resource}`}
                      className={(section === item.id || (item.id === "network" && section === "port-forwards")) && resourceTab === resource ? "active child" : "child"}
                      onClick={() => onSelectResource(item.id, resource)}
                    >
                      {resourceLabel(resource)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
