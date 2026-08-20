# KubeDeck 2.13.4 release notes

KubeDeck 2.13.4 brings Help and About up to date with the application they
describe, and puts the licence where someone running the build can see it.

No route changes. Node-only ownership stays at Node 58 / Python 0.

## Help was telling people to use a control that no longer exists

The quick start said to pick a cluster in the top bar. Clusters moved to the
left rail several releases ago - there is even a test pinning that the rail
replaced the dropdown - so the first instruction a new user followed led
nowhere.

Beyond that, Help described none of what the last few releases added. It is now
current on all of it:

- **Cluster connection** has a card of its own, placed right after the quick
  start because a grey rail badge is the first thing that stops a cluster from
  showing anything. It covers what the badge colours mean, that importing a
  kubeconfig connects nothing, where Connect and Disconnect live, what
  disconnecting stops, and that open sessions are named before they close.
- **The resource drawer** list now includes the LLM tab, the Secret tab and the
  usage history on a pod's Summary.
- **Main sections** now include Overview, Port-forwards and Audit.
- **The quick start** mentions Ctrl+K, which opens search across the cluster
  from anywhere.

## About had no licence in it

KubeDeck is Apache-2.0 and redistributes third-party components. Both facts
lived only in repository files - `LICENSE`, `NOTICE`, `docs/third-party-notices.md`
- which someone running the portable exe does not have. The release gate checks
those files exist; nothing put them in front of a user.

About now carries a licensing card: the licence, the copyright line quoted
verbatim from `NOTICE`, and a pointer to the third-party notices.

## The diagnostics report answers the two questions it kept being asked

Copy diagnostics now includes whether each cluster is connected, and the public
LLM status - enabled, configured, model and base URL.

"Nothing is updating" is usually a disconnected cluster, and "the analysis does
nothing" is usually an unconfigured model; neither was visible in the report
people paste when they ask. The LLM status shape carries no API key, and a test
asserts the panel never reaches for one.
