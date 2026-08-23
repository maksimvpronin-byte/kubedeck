import { Search } from "lucide-react";
import { NamespaceSelector } from "./NamespaceSelector";

interface Props {
  namespaces: string[];
  selectedNamespaces: string[];
  clusterScoped: boolean;
  namespaceUsage: Record<string, number>;
  globalSearch: string;
  backendOk: boolean;
  kubectlVersion: string;
  t: (key: string) => string;
  onNamespaceChange: (value: string | string[]) => void;
  onGlobalSearchChange: (value: string) => void;
  onCommandPaletteOpenChange: (open: boolean) => void;
}

// Namespace scope, the global search that opens the command palette, and the
// two runtime facts worth a permanent line: whether the backend answers and
// which kubectl it found.
export function AppTopbar({
  namespaces,
  selectedNamespaces,
  clusterScoped,
  namespaceUsage,
  globalSearch,
  backendOk,
  kubectlVersion,
  t,
  onNamespaceChange,
  onGlobalSearchChange,
  onCommandPaletteOpenChange,
}: Props) {
  return (
    <header className="topbar">
      <NamespaceSelector
        namespaces={namespaces}
        selected={clusterScoped ? ["_cluster"] : selectedNamespaces}
        disabled={clusterScoped}
        allLabel={t("resources.allNamespaces")}
        clusterScopedLabel={t("resources.clusterScoped")}
        searchLabel={t("resources.namespaceSearch")}
        emptySearchLabel={t("resources.namespaceSearchEmpty")}
        recentUsage={namespaceUsage}
        onChange={onNamespaceChange}
      />
      <label className="global-search" title="Ctrl+K">
        <Search size={16} />
        <input
          value={globalSearch}
          placeholder={`${t("app.search")} / Ctrl+K`}
          onFocus={() => onCommandPaletteOpenChange(true)}
          onChange={(event) => {
            onGlobalSearchChange(event.target.value);
            onCommandPaletteOpenChange(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") onCommandPaletteOpenChange(true);
            if (event.key === "Escape") onCommandPaletteOpenChange(false);
          }}
        />
      </label>
      <div className="status-line">
        <span>
          {t("status.backend")}: {backendOk ? t("common.ok") : "..."}
        </span>
        <span>
          {t("status.kubectl")}: {kubectlVersion || "..."}
        </span>
      </div>
    </header>
  );
}
