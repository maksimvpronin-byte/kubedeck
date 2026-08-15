import { ArrowDown, ArrowUp } from "lucide-react";

// The sort direction of a column header. Purely decorative: the header cell
// carries `aria-sort`, which is what a screen reader announces.
export function SortDirectionArrow({ direction }: { direction: 1 | -1 }) {
  return (
    <span className="table-sort-indicator" aria-hidden="true">
      {direction === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
    </span>
  );
}
