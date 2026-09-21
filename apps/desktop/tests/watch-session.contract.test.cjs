// The watch session, driven through every order of events rather than the few
// a person thinks to write down. Twice a race in it was found by reading: an
// end arriving before the start reply, a socket gap nobody reloaded after.
// Here each sequence of six events (no-ops included, so every shorter one too) runs against a small model of the
// gateway, and after every step the session must not claim a live watch that
// the model says is gone.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestScheduler, loadTypeScript } = require("./helpers/renderer.cjs");

const { createResourceWatchSession, WATCH_RESTART_DELAYS_MS } = loadTypeScript("hooks/useResourceWatch.ts");

const EVENTS = ["open", "close", "die", "reply", "refuse", "tick"];
const LONGEST_DELAY = Math.max(...WATCH_RESTART_DELAYS_MS);

const flush = () => new Promise((resolve) => setImmediate(resolve));

// The gateway as the session sees it: one shared watch per scope, started on
// request when none runs, and a `watch.ended` that reaches the client only if
// its socket is open at that moment. A start reply is decided when the request
// is served and delivered later - which is exactly how a reply can describe a
// watch that has died in the meantime.
function world() {
  const clock = createTestScheduler();
  const state = { socketOpen: false, alive: false, watchId: 0, pending: [], healthy: false, refreshes: 0, missed: false };
  const session = createResourceWatchSession({
    startWatch: () =>
      new Promise((resolve, reject) => {
        if (!state.alive) {
          state.watchId += 1;
          state.alive = true;
        }
        state.pending.push({ reply: { id: `w${state.watchId}`, status: "running" }, resolve, reject });
      }),
    requestRefresh: () => {
      state.refreshes += 1;
    },
    setHealthy: (healthy) => {
      state.healthy = healthy;
    },
    schedule: clock.scheduler.setTimeout,
    cancel: clock.scheduler.clearTimeout,
    now: clock.scheduler.now,
  });
  session.start();
  session.socketConnecting();

  const apply = async (event) => {
    if (event === "open" && !state.socketOpen) {
      state.socketOpen = true;
      session.socketOpened();
    } else if (event === "close" && state.socketOpen) {
      state.socketOpen = false;
      state.missed = true;
      session.socketClosed();
      session.socketConnecting();
    } else if (event === "die" && state.alive) {
      state.alive = false;
      state.missed = true;
      if (state.socketOpen) session.message({ type: "watch.ended", watchId: `w${state.watchId}` });
    } else if (event === "reply" && state.pending.length) {
      const next = state.pending.shift();
      next.resolve(next.reply);
    } else if (event === "refuse" && state.pending.length) {
      state.pending.shift().reject(new Error("forbidden"));
    } else if (event === "tick") {
      clock.advance(LONGEST_DELAY);
    }
    await flush();
  };

  return { state, session, apply };
}

function* sequences(length) {
  if (length === 0) {
    yield [];
    return;
  }
  for (const head of EVENTS) for (const rest of sequences(length - 1)) yield [head, ...rest];
}

test("in every order of events, a live watch is only claimed while the socket is open and the watch runs", async () => {
  let checked = 0;
  for (const sequence of sequences(6)) {
    const { state, session, apply } = world();
    for (const event of sequence) {
      await apply(event);
      if (state.healthy) {
        assert.ok(state.socketOpen, `healthy with the socket closed after ${sequence.join(" ")}`);
        assert.ok(state.alive, `healthy with a dead watch after ${sequence.join(" ")}`);
      }
    }

    // And it always finds its way back: with the socket open and the gateway
    // answering, the session ends up live - and has reloaded the table since
    // the last moment changes could have been missed.
    const refreshesBefore = state.refreshes;
    // Only a close or a death that actually happened can have lost a change.
    const missedSomething = state.missed;
    await apply("open");
    for (let round = 0; round < 6 && !state.healthy; round += 1) {
      while (state.pending.length) await apply("reply");
      if (!state.healthy) await apply("tick");
    }
    assert.ok(state.healthy, `never recovered after ${sequence.join(" ")}`);
    assert.ok(state.alive);
    if (missedSomething) assert.ok(state.refreshes > 0, `nothing reloaded after ${sequence.join(" ")}`);
    assert.ok(state.refreshes >= refreshesBefore);
    session.stop();
    checked += 1;
  }
  assert.equal(checked, EVENTS.length ** 6);
});

test("a stopped session touches nothing, whatever arrives after", async () => {
  const { state, session, apply } = world();
  await apply("open");
  await apply("reply");
  await apply("reply");
  assert.equal(state.healthy, true);
  session.stop();
  state.healthy = "untouched";
  session.message({ type: "watch.ended", watchId: "w1" });
  session.socketClosed();
  await apply("tick");
  assert.equal(state.healthy, "untouched");
  assert.equal(state.pending.length, 0, "no restart is requested after stop");
});
