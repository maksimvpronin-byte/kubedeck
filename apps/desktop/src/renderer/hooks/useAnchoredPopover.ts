import { useEffect, useRef, useState } from "react";
import { placeAnchoredPopover, type PopoverPlacement } from "../utils/popoverPlacement";

// Everything a popover anchored to a button needs and nothing it does not: it
// is placed from the trigger's rectangle, closes on Escape or a click outside
// itself, and follows the trigger while the window resizes or the content
// behind it scrolls. Three surfaces open one of these, and each used to carry
// its own copy of the same effect.
export function useAnchoredPopover(width: number, height: number) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<PopoverPlacement | null>(null);
  const open = placement !== null;

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      // The trigger closes through its own click handler; swallowing its
      // pointerdown here would reopen the popover on the click that follows.
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setPlacement(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPlacement(null);
    };
    const reposition = () => {
      if (triggerRef.current) setPlacement(placeAnchoredPopover(triggerRef.current, width, height));
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, width, height]);

  const toggle = () => {
    const trigger = triggerRef.current;
    setPlacement((current) => (current || !trigger ? null : placeAnchoredPopover(trigger, width, height)));
  };

  return { placement, open, triggerRef, popoverRef, toggle, close: () => setPlacement(null) };
}
