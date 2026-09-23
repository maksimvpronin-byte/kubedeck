import { useMemo, useRef } from "react";
import type { ErrorInfo } from "../types";

// The application has one error banner, and panels that poll or load on mount
// share it. A panel may take down an error it put up itself, never one some
// other request raised: clearing on every success wiped a failed settings save,
// or the very error whose "Open settings" button brought the user here.
export function useOwnedError(onError: (error: ErrorInfo | null) => void) {
  const ownedRef = useRef(false);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  return useMemo(
    () => ({
      report(error: ErrorInfo) {
        ownedRef.current = true;
        onErrorRef.current(error);
      },
      clear() {
        if (!ownedRef.current) return;
        ownedRef.current = false;
        onErrorRef.current(null);
      },
    }),
    [],
  );
}
