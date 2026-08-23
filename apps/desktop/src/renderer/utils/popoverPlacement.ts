// Where a popover anchored to a button goes when it is rendered into the body
// rather than beside its trigger. Panels clip what overflows them and a
// container-type makes them the containing block even for a fixed child, so a
// popover that must be seen whole leaves the panel and is placed from the
// trigger's own rectangle - bounded by the window instead of by the panel.
export interface PopoverPlacement {
  top: number;
  left: number;
  maxHeight: number;
}

export const VIEWPORT_MARGIN = 12;
export const TRIGGER_GAP = 6;
const MIN_HEIGHT = 120;

export function placeAnchoredPopover(trigger: HTMLElement, width: number, preferredHeight: number): PopoverPlacement {
  const bounds = trigger.getBoundingClientRect();
  const below = window.innerHeight - bounds.bottom - TRIGGER_GAP - VIEWPORT_MARGIN;
  const above = bounds.top - TRIGGER_GAP - VIEWPORT_MARGIN;
  // Upwards only when it genuinely helps: a popover that flips for a few pixels
  // is more surprising than one that scrolls.
  const upward = below < Math.min(preferredHeight, 220) && above > below;
  const maxHeight = Math.max(MIN_HEIGHT, Math.min(preferredHeight, upward ? above : below));
  return {
    top: upward ? Math.max(VIEWPORT_MARGIN, bounds.top - TRIGGER_GAP - maxHeight) : bounds.bottom + TRIGGER_GAP,
    left: Math.max(VIEWPORT_MARGIN, Math.min(bounds.right - width, window.innerWidth - VIEWPORT_MARGIN - width)),
    maxHeight,
  };
}
