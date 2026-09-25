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

// Columns drawn as something other than a line of text - status cubes, chips,
// bars - whose width cannot be worked out from the rows. Every other cell is
// its text; the namespace pill is text at a smaller size, which only errs on
// the wide side.
const DRAWN_COLUMNS = new Set(["containers", "status", "labelsText", "roles", "nodeAnnotations", ...UNFITTABLE_COLUMNS]);
// A cell's padding, and what a header adds to its label: the sort arrow.
const CELL_PADDING = 20;
const SORT_INDICATOR = 18;
// Only the longest few values of a column are measured: the widest text is
// almost always among the longest strings, and a page can be 2000 rows.
const MEASURED_VALUES = 12;

export type TextMeasure = (text: string, bold: boolean) => number;

// An age is drawn from the clock, not from the row, and its longest form is a
// time of day; a phase is drawn bold.
const AGE_SAMPLE = "00:00:00";
const BOLD_COLUMNS = new Set(["phase"]);

// How wide each text column needs to be for every row of the page, header
// included. Columns drawn as something other than their text are left out.
export function textColumnWidths<Row extends Record<string, unknown>>(
  rows: Row[],
  columns: Array<{ key: string; label: string }>,
  measure: TextMeasure,
  // The text a cell shows, when that is not the row's value as it stands.
  cellText: (row: Row, key: string) => string = (row, key) => String(row[key] ?? ""),
): Record<string, number> {
  const widths: Record<string, number> = {};
  for (const column of columns) {
    if (DRAWN_COLUMNS.has(column.key)) continue;
    const values = column.key === "createdAt" ? [AGE_SAMPLE] : rows.map((row) => cellText(row, column.key));
    values.sort((left, right) => right.length - left.length);
    let widest = measure(column.label, true) + SORT_INDICATOR;
    for (const value of values.slice(0, MEASURED_VALUES)) widest = Math.max(widest, measure(value, BOLD_COLUMNS.has(column.key)));
    widths[column.key] = Math.ceil(widest) + CELL_PADDING + FIXED_LAYOUT_ALLOWANCE;
  }
  return widths;
}

// A compact table is as wide as its columns. A width is kept per resource, not
// per cluster, so one fitted to the node names of one cluster is mostly empty
// in the next - and a table that ran past the window over empty space had a
// scrollbar with nothing to scroll to. While the columns do not fit, a text
// column gives back what its text does not use; one that fits keeps its width,
// and one whose text is longer than it is never widened.
export function withoutEmptySpace(widths: Record<string, number>, content: Record<string, number>, available: number, fixed: number): Record<string, number> {
  const total = fixed + Object.values(widths).reduce((sum, width) => sum + width, 0);
  if (!(available > 0) || total <= available) return widths;
  const next: Record<string, number> = {};
  for (const [key, width] of Object.entries(widths)) {
    const needed = content[key];
    next[key] = needed !== undefined && needed < width ? needed : width;
  }
  return next;
}

let context: CanvasRenderingContext2D | null | undefined;

// Measures text in the fonts the table's cells and headers are drawn in, or
// null before there is a row to take them from.
export function tableTextMeasure(table: HTMLTableElement | null): TextMeasure | null {
  const cell = table?.querySelector("tbody td:not(.select-col):not(.filler-col)");
  const header = table?.querySelector("thead .table-sort-button") ?? table?.querySelector("thead th");
  if (!cell || !header) return null;
  if (context === undefined) context = document.createElement("canvas").getContext("2d");
  const measuring = context;
  if (!measuring) return null;
  const cellFont = getComputedStyle(cell).font;
  const headerFont = getComputedStyle(header).font;
  return (text, isHeader) => {
    measuring.font = isHeader ? headerFont : cellFont;
    return measuring.measureText(text).width;
  };
}
