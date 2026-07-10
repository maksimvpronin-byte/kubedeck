interface Props {
  rowCount: number; pageStart: number; renderedCount: number; pageSize: number; pageSizeOptions: number[];
  pageIndex: number; totalPages: number;
  labels: { rows: string; of: string; pageSize: string; first: string; prev: string; next: string; last: string };
  onPageSizeChange: (size: number) => void; onPageChange: (index: number) => void;
}

export function ResourceTablePagination({ rowCount, pageStart, renderedCount, pageSize, pageSizeOptions, pageIndex, totalPages, labels, onPageSizeChange, onPageChange }: Props) {
  return (
    <div className="table-footer">
      <span>{labels.rows} {rowCount === 0 ? 0 : pageStart + 1}-{Math.min(pageStart + renderedCount, rowCount)} {labels.of} {rowCount}</span>
      <label>
        {labels.pageSize}{" "}
        <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
          {pageSizeOptions.map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
      </label>
      <div className="pagination-actions">
        <button className="secondary-btn" type="button" onClick={() => onPageChange(0)} disabled={pageIndex === 0}>{labels.first}</button>
        <button className="secondary-btn" type="button" onClick={() => onPageChange(Math.max(0, pageIndex - 1))} disabled={pageIndex === 0}>{labels.prev}</button>
        <span>{pageIndex + 1} / {totalPages}</span>
        <button className="secondary-btn" type="button" onClick={() => onPageChange(Math.min(totalPages - 1, pageIndex + 1))} disabled={pageIndex >= totalPages - 1}>{labels.next}</button>
        <button className="secondary-btn" type="button" onClick={() => onPageChange(totalPages - 1)} disabled={pageIndex >= totalPages - 1}>{labels.last}</button>
      </div>
    </div>
  );
}
