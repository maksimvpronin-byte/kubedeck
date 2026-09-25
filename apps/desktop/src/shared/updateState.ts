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
  /**
   * What the versions between this one and the one on offer change, newest
   * first. Empty until a check finds a newer release.
   */
  releaseNotes: ReleaseNote[];
}

/** One release's notes, as GitHub renders them: HTML, not Markdown. */
export interface ReleaseNote {
  version: string;
  html: string;
}

// electron-updater hands over a string when it read one release and a list
// when it read the changelog, and nothing at all when the release has no body.
// One shape for the window, with the empty entries dropped.
export function releaseNotesOf(info: { version: string; releaseNotes?: string | Array<{ version: string; note?: string | null }> | null }): ReleaseNote[] {
  const notes = info.releaseNotes;
  if (typeof notes === "string") return notes.trim() ? [{ version: info.version, html: notes }] : [];
  if (!Array.isArray(notes)) return [];
  return notes.filter((entry) => typeof entry.note === "string" && entry.note.trim()).map((entry) => ({ version: entry.version, html: entry.note as string }));
}
