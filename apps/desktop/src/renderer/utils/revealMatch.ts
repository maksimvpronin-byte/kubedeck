// Bringing a found occurrence into view inside a pane that scrolls both ways.
// The log viewer does not wrap its lines, so a match can sit a thousand pixels
// to the right of what the reader can see: moving only the rows would leave the
// pane looking like it never went anywhere.

// Down the pane the match is centred, the way a jump between matches reads
// everywhere else.
export function verticalShift(top: number, height: number, viewport: number): number {
  return top - viewport / 2 + height / 2;
}

// Across it the match is only pulled in when it is off the edge, and then far
// enough that the text around it comes along. A match already on screen keeps
// the column the reader chose, so stepping down a log does not shuffle it
// sideways on every step.
const HORIZONTAL_MARGIN = 80;

export function horizontalShift(left: number, width: number, viewport: number): number {
  const right = left + width;
  const margin = Math.min(HORIZONTAL_MARGIN, Math.max(0, (viewport - width) / 2));
  if (left >= margin && right <= viewport - margin) return 0;
  // An occurrence wider than the pane cannot be framed, so it is centred and
  // read from there.
  if (width >= viewport) return left - viewport / 2 + width / 2;
  if (left < margin) return left - margin;
  return right - (viewport - margin);
}
