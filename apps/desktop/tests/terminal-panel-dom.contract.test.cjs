// The bottom terminal panel, with the terminals themselves stubbed out: what is
// under test is the tabs and the panel around them, not xterm.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadComponent, mount, React } = require("./helpers/dom.cjs");
const { useBottomTerminals } = loadComponent("hooks/useBottomTerminals.ts");

// The terminal offers a way to switch containers, as the real one does.
const { BottomTerminalPanel } = loadComponent("components/BottomTerminalPanel.tsx", {
  "./TerminalTab": {
    TerminalTab: ({ container, setContainer }) => React.createElement("button", { className: "switch-container", onClick: () => setContainer("sidecar") }, `in ${container}`),
  },
  "./NodeSshTab": { NodeSshTab: () => null },
});

const CLUSTER = { id: "c1", displayName: "prod" };
const POD = { uid: "p1", name: "api-server", namespace: "default" };

function Harness() {
  const terminals = useBottomTerminals({ activeCluster: CLUSTER, t: (key) => key, setError: () => {} });
  React.useEffect(() => {
    terminals.openBottomTerminal(POD, ["app", "sidecar"], "app");
    // Opened once, on mount.
  }, []);
  if (!terminals.bottomTerminals.length) return null;
  return React.createElement(BottomTerminalPanel, {
    api: {},
    targets: terminals.bottomTerminals,
    activeId: terminals.activeBottomTerminalId,
    openToken: terminals.bottomTerminalOpenToken,
    t: (key) => key,
    onActivate: terminals.setActiveBottomTerminalId,
    onClose: terminals.closeBottomTerminal,
    onContainerChange: terminals.setBottomTerminalContainer,
  });
}

test("a terminal switched to another container says so on its tab", () => {
  const view = mount(React.createElement(Harness));
  try {
    assert.match(view.text(".bottom-terminal-tab small"), /app/);
    view.click(view.first(".switch-container"));
    assert.match(view.text(".bottom-terminal-tab small"), /sidecar/, "the tab names the container the terminal is in now");
    assert.match(view.first(".bottom-terminal-tab button").getAttribute("title"), /sidecar/);
    assert.equal(view.text(".switch-container"), "in sidecar");
  } finally {
    view.unmount();
  }
});
