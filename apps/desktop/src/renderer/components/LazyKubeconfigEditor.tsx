import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";

// The kubeconfig editor as the rail and the sidebar open it. It is CodeMirror,
// so it is loaded the first time a kubeconfig is edited rather than with the
// application, and nothing is drawn while it arrives: a modal has no slot to
// hold a loading message in.
const KubeconfigEditorModal = lazy(() => import("./KubeconfigEditorModal").then((module) => ({ default: module.KubeconfigEditorModal })));

export function LazyKubeconfigEditor(props: ComponentProps<typeof KubeconfigEditorModal>) {
  if (!props.cluster) return null;
  return (
    <Suspense fallback={null}>
      <KubeconfigEditorModal {...props} />
    </Suspense>
  );
}
