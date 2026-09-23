export interface UiState {
  drawerWidth?: number;
  sidebarWidth?: number;
  bottomTerminalHeight?: number;
  expandedSections?: string[];
  expandedCrdGroups?: string[];
  section?: string;
  resourceTab?: string;
  namespace?: string;
  selectedNamespaces?: string[];
  namespaceSelectionVersion?: 2;
  selectedNamespacesByClusterId?: Record<string, string[]>;
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
  // A convenience, written from effects: a full or refused localStorage must
  // not throw out of one and take the window down with it.
  try {
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Widths, columns and the last section are simply not remembered.
  }
}
