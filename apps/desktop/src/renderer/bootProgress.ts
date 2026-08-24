// The renderer side of public/boot-screen.js: the stages the boot screen shows
// and the calls that move it along. Every call is a no-op when the screen is
// gone (it removes itself once the start is over) or absent (renderer tests,
// a page opened outside Electron), so callers never have to check.
export const BOOT_STAGES = ["ui", "gateway", "config", "kubectl", "cluster"] as const;

export type BootStage = (typeof BOOT_STAGES)[number];

export interface BootScreenApi {
  version: number;
  begin(stage: string, detail?: string): void;
  complete(stage: string): void;
  fail(stage: string, message?: string): void;
  finish(): void;
  isFinished(): boolean;
}

function bootScreen(): BootScreenApi | null {
  if (typeof window === "undefined") return null;
  const api = window.__kubedeckBoot;
  return api && api.version === 1 && !api.isFinished() ? api : null;
}

export function beginBootStage(stage: BootStage, detail?: string) {
  bootScreen()?.begin(stage, detail);
}

export function completeBootStage(stage: BootStage) {
  bootScreen()?.complete(stage);
}

export function failBootStage(stage: BootStage, message?: string) {
  bootScreen()?.fail(stage, message);
}

export function finishBoot() {
  bootScreen()?.finish();
}
