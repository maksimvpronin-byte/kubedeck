# KubeDeck 2.17.0 release notes

A CronJob can be run by hand. **Run now** sits beside Delete in the CronJob
drawer and starts one run immediately, without waiting for the schedule and
without touching it.

No route changes. Node-only ownership stays at Node 58 / Python 0.

## What it does

Exactly what `kubectl create job --from=cronjob/<name>` does: the job template
is copied out of the CronJob and one Job is created from it. The schedule is
not modified, the CronJob is not suspended or resumed, and the next scheduled
run happens as it would have anyway.

The new Job appears under Jobs, and its pods under Pods, like any other run.

## The name of the run

A Job needs a name of its own, and the CronJob controller names its scheduled
runs `<cronjob>-<unix-minute>`. A manual run says so: `<cronjob>-manual-<unix
second>`. The second, rather than the minute, means two manual runs a few
seconds apart do not collide.

Kubernetes takes a DNS-1123 label of at most 63 characters, so a long CronJob
name is truncated to leave room for the suffix.

The name is fixed the moment the button is pressed, not while the confirmation
is open, so the command shown in the preview is the command that runs - the
confirmation would not be worth reading otherwise.

## Before it runs

The same confirmation every mutating action gets: what will happen, the target,
and the exact kubectl command. Running a CronJob is treated as a mutating
action, so it carries a typed confirmation the way Restart, Redeploy and Scale
do.

Authorization is checked first with `kubectl auth can-i create jobs` in the
CronJob's namespace, so a missing permission is reported as a permission
problem rather than a raw kubectl failure. The run is recorded in the audit
trail as `resource.trigger`, carrying the name of the Job it created.

## Nothing else moved

Every other resource keeps the actions it had. Deleting a CronJob works as it
did, and the CronJob drawer's Summary, YAML, Describe, Related and Events tabs
are untouched.
