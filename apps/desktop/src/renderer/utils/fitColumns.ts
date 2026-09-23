// Columns whose cells are bars drawn to the column's width: they have no width
// of their own to fit to, so fitting leaves them as they are.
export const UNFITTABLE_COLUMNS = new Set(["nodeResources", "podResources", "namespaceResources"]);

const FIXED_LAYOUT_ALLOWANCE = 10;

// Asks the browser how wide each column's content wants to be. For one
// synchronous moment the table is laid out automatically - no fixed widths,
// cells free to be as wide as their text - and the header cells, which then
// span their whole column, are measured; everything is put back before the
// next paint, so nothing flickers. Only the rows in the document take part,
// which with the table's virtual scrolling means the rows around the viewport.
//
// `keys` are the visible columns in order; the first header cell is the
// selection checkbox. With `only`, just that column is measured.
export function measureColumnWidths(table: HTMLTableElement, keys: string[], only?: string): Record<string, number> {
  const cols = Array.from(table.querySelectorAll<HTMLTableColElement>("colgroup col"));
  const saved = {
    tableLayout: table.style.tableLayout,
    width: table.style.width,
    minWidth: table.style.minWidth,
    cols: cols.map((col) => col.style.width),
  };
  table.style.tableLayout = "auto";
  table.style.width = "max-content";
  table.style.minWidth = "0";
  for (const col of cols) col.style.width = "auto";
  table.classList.add("is-measuring");
  try {
    const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>("thead tr:first-child > th"));
    const widths: Record<string, number> = {};
    keys.forEach((key, index) => {
      if (UNFITTABLE_COLUMNS.has(key) || (only && key !== only)) return;
      const cell = headers[index + 1];
      // Over by what the fixed layout takes back: there a header's sort button
      // gets about 8px less than the automatic layout measured for it, and a
      // label fitted exactly came back as "A…".
      if (cell) widths[key] = Math.ceil(cell.getBoundingClientRect().width) + FIXED_LAYOUT_ALLOWANCE;
    });
    return widths;
  } finally {
    table.classList.remove("is-measuring");
    table.style.tableLayout = saved.tableLayout;
    table.style.width = saved.width;
    table.style.minWidth = saved.minWidth;
    cols.forEach((col, index) => {
      col.style.width = saved.cols[index];
    });
  }
}
