// Two panels reading the same recorded samples on two independent timers drift
// up to a full interval apart, because each timer starts whenever its component
// mounted. For a pod whose memory is climbing a few hundred megabytes per tick
// that shows up as the table and the drawer disagreeing about the same pod at
// the same moment.
//
// Aligning to wall-clock boundaries costs nothing and removes the drift: every
// caller on the same interval fires on the same instants, so they read the same
// recorded sample.
export function setAlignedInterval(callback: () => void, intervalMs: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = () => {
    // Never 0: at an exact boundary the next tick is a whole interval away.
    const delay = intervalMs - (Date.now() % intervalMs);
    timer = setTimeout(() => {
      callback();
      schedule();
    }, delay);
  };

  schedule();
  return () => {
    if (timer !== undefined) clearTimeout(timer);
  };
}
