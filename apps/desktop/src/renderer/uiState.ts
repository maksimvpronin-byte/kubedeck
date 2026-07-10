export interface UiState {
  drawerWidth?: number;
  sidebarWidth?: number;
  expandedSections?: string[];
  expandedCrdGroups?: string[];
  section?: string;
  resourceTab?: string;
  namespace?: string;
  selectedNamespaces?: string[];
  columnWidths?: Record<string, Record<string, number>>;
  columnOrders?: Record<string, string[]>;
  hiddenColumns?: Record<string, string[]>;
}

const key = "kubedeck.uiState.v1";

export function loadUiState(): UiState {
  try {
    return JSON.parse(window.localStorage.getItem(key) || "{}") as UiState;
  } catch {
    return {};
  }
}

export function saveUiState(next: UiState) {
  window.localStorage.setItem(key, JSON.stringify(next));
}
