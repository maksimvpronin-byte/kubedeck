# KubeDeck 2.13.3 release notes

KubeDeck 2.13.3 lets the LLM prompt preview be closed while an analysis is
running.

No route changes. Node-only ownership stays at Node 58 / Python 0.

## Hide prompt was disabled for as long as the model took to answer

Opening the prompt preview and then starting an analysis left the prompt filling
the tab, with its own button greyed out until the answer came back. On a slow
local model that is a long time to sit with a wall of prompt text and no way to
get past it.

The button was tied to a flag shared with the analysis, but the two actions are
not alike. Opening the preview fetches the resource again and builds the prompt;
closing it sets a boolean and returns, without touching the network. Only the
opening direction has anything to wait for.

The button now waits on its own work and nothing else, so closing is always
available. Opening during an analysis is allowed too - it is a separate read,
and a run in progress is exactly when the question "what did it actually send?"
comes up.

Starting a second analysis while one is in flight is still blocked.
