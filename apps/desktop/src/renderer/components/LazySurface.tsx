import { Suspense } from "react";
import type { ReactNode } from "react";
import { LazyPanelBoundary } from "./LazyPanelBoundary";

// Every lazily loaded panel is mounted through this: a boundary that resets on
// navigation, over a Suspense fallback that keeps the panel's slot occupied
// while its chunk arrives.
export function LazySurface({ resetKey, children }: { resetKey: string; children: ReactNode }) {
  return (
    <LazyPanelBoundary resetKey={resetKey}>
      <Suspense
        fallback={
          <div className="panel-loading" role="status">
            Loading…
          </div>
        }
      >
        {children}
      </Suspense>
    </LazyPanelBoundary>
  );
}
