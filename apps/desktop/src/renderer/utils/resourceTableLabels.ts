export function createResourceTableLabels(t: (key: string) => string) {
  return {
    shownOf: t("resources.shownOf"),
    page: t("resources.page"),
    deleteSelected: t("resources.deleteSelected"),
    rows: t("resources.rows"),
    of: t("resources.of"),
    pageSize: t("resources.pageSize"),
    first: t("pagination.first"),
    prev: t("pagination.prev"),
    next: t("pagination.next"),
    last: t("pagination.last"),
    emptyTitle: t("resources.emptyTitle"),
    emptyText: t("resources.emptyText"),
    emptyFilteredTitle: t("resources.emptyFilteredTitle"),
    emptyFilteredText: t("resources.emptyFilteredText"),
    clearFilter: t("resources.clearFilter"),
    columns: t("resources.columns"),
    resetColumns: t("resources.resetColumns"),
  };
}
