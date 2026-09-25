// The Updates card in About, rendered: a new version is shown with what it
// changes, and the notes - HTML from a GitHub release, not ours - come through
// as text and a handful of tags, never as markup that runs or loads.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadComponent, mount, React, window } = require("./helpers/dom.cjs");

const { AboutPanel } = loadComponent("components/AboutPanel.tsx");
const { renderReleaseNote } = loadComponent("components/ReleaseNotes.tsx");

const NOTES = `<h1>KubeDeck 2.28.0 release notes</h1>
<p>Two fixes, one <code>kubectl</code><br>
change.</p>
<h2>Tables</h2>
<ul>
<li>Age reads <strong>1y35d</strong>, not 400d.</li>
<li>See <a href="./REGRESSION_CHECKLIST_2.28.0.md">the checklist</a>.</li>
</ul>
<script>window.__ran = true</script>
<img src="https://example.com/pixel.png" onerror="window.__ran = true">
<h2>Verification</h2>
<ul><li><code>npm run test:renderer</code> - 300 tests</li></ul>
<h2>Updates</h2>
<p>Restart and install is silent.</p>`;

function updateState(patch) {
  return {
    status: "idle",
    currentVersion: "2.27.1",
    availableVersion: "",
    percent: 0,
    message: "",
    canInstall: true,
    releasesUrl: "https://github.com/maksimvpronin-byte/kubedeck/releases",
    releaseNotes: [],
    ...patch,
  };
}

function installBridge() {
  const bridge = {
    listener: null,
    calls: [],
    // Never answers: About's own info is not what these tests are about.
    getDesktopInfo: () => new Promise(() => {}),
    getUpdateState: () => new Promise(() => {}),
    onUpdateState(listener) {
      bridge.listener = listener;
      return () => {
        bridge.listener = null;
      };
    },
    checkForUpdates: async () => bridge.calls.push("check"),
    downloadUpdate: async () => bridge.calls.push("download"),
    installUpdate: async () => bridge.calls.push("install"),
    openReleases: async () => bridge.calls.push("releases"),
    openAppFolder: async () => undefined,
  };
  window.kubedeck = bridge;
  return bridge;
}

function about() {
  return React.createElement(AboutPanel, {
    api: null,
    config: null,
    activeCluster: null,
    backendOk: true,
    kubectlVersion: "",
    t: (key) => key,
    onError: () => {},
  });
}

test("release notes keep their text and a few tags, and nothing that runs or loads", () => {
  const holder = document.createElement("div");
  const ReactDOMClient = require("react-dom/client");
  const root = ReactDOMClient.createRoot(holder);
  React.act(() => root.render(React.createElement("div", null, ...renderReleaseNote(NOTES))));

  assert.ok(!holder.querySelector("script, img, a, h1"), "no script, image, link or title comes through");
  assert.equal(window.__ran, undefined);
  assert.equal(holder.querySelector("strong").textContent, "1y35d");
  assert.match(holder.textContent, /the checklist/, "a link keeps its text");
  assert.deepEqual(
    [...holder.querySelectorAll("h5")].map((heading) => heading.textContent),
    ["Tables", "Updates"],
    "the maintainer's Verification section is left out, and what follows it is not",
  );
  assert.doesNotMatch(holder.textContent, /300 tests/);
  assert.ok(!holder.querySelector("br"), "a wrapped line of the Markdown is not a line break");
  assert.match(holder.querySelector("p").textContent, /kubectl\s+change/);
  React.act(() => root.unmount());
});

test("a new version is offered with what it changes and the button that gets it", (t) => {
  const bridge = installBridge();
  const view = mount(about());
  t.after(() => view.unmount());
  assert.ok(!view.first(".update-offer"), "nothing is offered before a check finds something");

  React.act(() =>
    bridge.listener(
      updateState({
        status: "available",
        availableVersion: "2.29.0",
        releaseNotes: [
          { version: "2.29.0", html: "<p>Newest.</p>" },
          { version: "2.28.0", html: NOTES },
        ],
      }),
    ),
  );
  const offer = view.first(".update-offer");
  assert.ok(offer, "the offer is shown");
  assert.match(offer.textContent, /KubeDeck 2\.29\.0/);
  assert.match(offer.textContent, /2\.27\.1/, "and the version installed now");
  assert.deepEqual(
    view.all(".release-notes-version-title").map((heading) => heading.textContent),
    ["2.29.0", "2.28.0"],
    "every version skipped is listed, newest first",
  );

  const download = [...offer.querySelectorAll("button")].find((button) => button.textContent === "about.updateDownload");
  assert.ok(download, "the download button is in the offer");
  view.click(download);
  assert.deepEqual(bridge.calls, ["download"]);

  React.act(() => bridge.listener(updateState({ status: "downloaded", availableVersion: "2.29.0", percent: 100, releaseNotes: [{ version: "2.29.0", html: "<p>Newest.</p>" }] })));
  assert.ok(
    view.all(".update-offer button").some((button) => button.textContent === "about.updateInstall"),
    "once downloaded, the offer installs",
  );
  assert.equal(view.all(".release-notes-version-title").length, 0, "a single release needs no version heading of its own");
});

test("a build that cannot install says why once, and is pointed at the releases", (t) => {
  const bridge = installBridge();
  const view = mount(about());
  t.after(() => view.unmount());

  React.act(() => bridge.listener(updateState({ status: "unsupported", canInstall: false, message: "about.update.reason.development" })));
  const rows = view.all(".about-row").filter((row) => /about\.update\.reason\.development/.test(row.textContent));
  assert.equal(rows.length, 1, "the reason is the status, not a second row as well");

  React.act(() => bridge.listener(updateState({ status: "available", availableVersion: "2.29.0", canInstall: false, message: "about.update.reason.portable" })));
  const buttons = view.all(".update-offer button").map((button) => button.textContent);
  assert.deepEqual(buttons, ["about.updateReleases"], "a portable build is sent to the release page, not offered a download");
  assert.match(view.text(".update-offer"), /about\.releaseNotesMissing/, "and says the notes are there when none came");
});
