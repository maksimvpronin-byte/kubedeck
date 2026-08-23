// A CronJob run started by hand is a Job, and a Job needs a name of its own.
// The controller names its scheduled runs `<cronjob>-<unix-minute>`; a manual
// run says so, and carries the second it was asked for, so two runs a minute
// apart - or a second apart - cannot collide.
const MAX_JOB_NAME_LENGTH = 63;

export function manualJobName(cronjob: string, now: number): string {
  const suffix = `-manual-${Math.floor(now / 1000)}`;
  // Kubernetes takes a DNS-1123 label of at most 63 characters, and a CronJob
  // name can be long enough that the suffix would push it past that.
  const base = cronjob
    .toLowerCase()
    .slice(0, MAX_JOB_NAME_LENGTH - suffix.length)
    .replace(/-+$/, "");
  return `${base || "cronjob"}${suffix}`;
}
