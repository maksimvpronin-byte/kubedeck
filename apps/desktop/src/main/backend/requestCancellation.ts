import type { IncomingMessage, ServerResponse } from "node:http";
import { KubectlError } from "./kubectl/errors";

// The renderer aborts requests routinely: every resource tab switch cancels the
// previous list load, and every keystroke in the command palette cancels the
// previous search. Without this the fetch was gone but the work was not - the
// kubectl processes behind it kept running to completion, parsing megabytes of
// JSON for an answer nobody could read.
export function requestAbortSignal(request: IncomingMessage, response: ServerResponse): AbortSignal {
  const controller = new AbortController();

  // A finished response closes its socket too, so the close alone means
  // nothing; what marks an abandoned request is closing before the answer was
  // written.
  const onClose = () => {
    if (!response.writableEnded) controller.abort();
  };

  // `response` is what knows whether the answer went out, and its "close"
  // fires for both endings - one listener, no cleanup to forget.
  response.on("close", onClose);
  // A request destroyed before the response ever reached the handler would
  // otherwise leave the signal unaborted until the response closes with it.
  request.on("aborted", onClose);

  return controller.signal;
}

// A cancelled command is the expected end of an abandoned request, not a
// failure: it must not be logged as one, must not clear caches, and has no
// response left to write to.
export function isRequestCancelled(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return error instanceof KubectlError && error.info.code === "KUBECTL_CANCELLED";
}
