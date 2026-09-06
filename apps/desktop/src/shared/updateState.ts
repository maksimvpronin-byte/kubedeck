// The one description of "is there a new KubeDeck, and can this copy install
// it". The main process owns it, the preload passes it across and the renderer
// renders it, so it lives beside formatQuantity.ts rather than in either.

export type UpdateStatus =
  /** Nothing has been asked yet. */
  | "idle"
  /** A check is in flight. */
  | "checking"
  /** This is the newest release. */
  | "current"
  /** A newer release exists and has not been downloaded. */
  | "available"
  /** The newer release is coming down. */
  | "downloading"
  /** The newer release is on disk and installs on restart. */
  | "downloaded"
  /** This build cannot ask - a development run, or one with no release behind it. */
  | "unsupported"
  /** The last attempt failed; `message` says how. */
  | "error";

export interface UpdateState {
  status: UpdateStatus;
  /** The version running now. */
  currentVersion: string;
  /** The version on offer, once a check has found one. */
  availableVersion: string;
  /** Download progress, 0-100. Only meaningful while `downloading`. */
  percent: number;
  /** Why the last attempt failed, or why this build cannot install in place. */
  message: string;
  /**
   * Whether this copy can replace itself. False for the Windows portable
   * build, which has no installation to replace, and for an unsigned macOS
   * build, which Squirrel refuses to update. Those still learn that a new
   * version exists - they are pointed at the release page instead.
   */
  canInstall: boolean;
  /** Where to go when installing in place is not on offer. */
  releasesUrl: string;
}
