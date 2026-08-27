// A page of the resource table can be 2000 rows, and every one of them is a
// dozen cells of real DOM. Below the threshold the table renders every row, as
// it always has - that is the default page size and the case nobody should pay
// a scrolling abstraction for. Above it, only the rows near the viewport are
// rendered and the rest are two spacer rows holding the scroll height.
export const VIRTUAL_ROW_THRESHOLD = 200;
// Rows above and below the viewport that are rendered anyway, so a flick of the
// wheel does not show a gap before the next frame.
export const VIRTUAL_ROW_OVERSCAN = 12;
export const DEFAULT_VIRTUAL_ROW_HEIGHT = 28;

export interface VirtualRowWindow {
  active: boolean;
  start: number;
  end: number;
  paddingTop: number;
  paddingBottom: number;
}

export interface VirtualRowInput {
  rowCount: number;
  rowHeight: number;
  scrollTop: number;
  viewportHeight: number;
  threshold?: number;
  overscan?: number;
}

export function virtualRowWindow({ rowCount, rowHeight, scrollTop, viewportHeight, threshold = VIRTUAL_ROW_THRESHOLD, overscan = VIRTUAL_ROW_OVERSCAN }: VirtualRowInput): VirtualRowWindow {
  const height = rowHeight > 0 ? rowHeight : DEFAULT_VIRTUAL_ROW_HEIGHT;
  // Without a measured viewport there is nothing to be near, so everything is
  // rendered rather than guessed at.
  if (rowCount <= threshold || viewportHeight <= 0) {
    return { active: false, start: 0, end: rowCount, paddingTop: 0, paddingBottom: 0 };
  }

  const first = Math.max(0, Math.floor(Math.max(0, scrollTop) / height) - overscan);
  const visible = Math.ceil(viewportHeight / height) + overscan * 2;
  const last = Math.min(rowCount, first + visible);

  return {
    active: true,
    start: first,
    end: last,
    paddingTop: first * height,
    paddingBottom: Math.max(0, (rowCount - last) * height),
  };
}

// The rows are measured rather than assumed: a nodes table draws two lines of
// usage in a cell and is taller than a pods table. A change smaller than a pixel
// is ignored, because re-rendering for it would cost more than it corrects.
export function nextRowHeight(current: number, measured: number): number {
  if (!Number.isFinite(measured) || measured <= 0) return current;
  return Math.abs(measured - current) < 1 ? current : measured;
}
