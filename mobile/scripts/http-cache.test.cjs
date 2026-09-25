const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const PREVIEW_KEY = "asta_browse_cache_v1";
const RACES = "/races?scope=my_league";
const source = fs.readFileSync(path.join(__dirname, "../src/api/http.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const plain = (value) => JSON.parse(JSON.stringify(value));
const tick = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function response(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => value };
}

function preview(owner, value, previewUntil = Date.now() + 60_000) {
  return JSON.stringify({ owner, entries: [[RACES, { expiresAt: Date.now() + 30_000, previewUntil, value }]] });
}

function fixture(t, { token = "account-a", savedPreview, fetch: fetchImpl = async () => response({}) } = {}) {
  const disk = new Map(savedPreview ? [[PREVIEW_KEY, savedPreview]] : []);
  const timers = new Set();
  const calls = [];
  const module = { exports: {} };
  const context = {
    exports: module.exports,
    module,
    AbortController,
    window: { localStorage: {
      getItem: (key) => disk.get(key) ?? null,
      setItem: (key, value) => disk.set(key, value),
      removeItem: (key) => disk.delete(key),
    } },
    setTimeout: (fn, delay) => {
      const timer = setTimeout(() => { timers.delete(timer); fn(); }, delay);
      timers.add(timer);
      return timer;
    },
    clearTimeout: (timer) => { clearTimeout(timer); timers.delete(timer); },
    fetch: (url, init) => {
      calls.push({ url, init });
      return fetchImpl(url, init);
    },
    require: (name) => {
      if (name === "../lib/tokenStorage") return { getToken: async () => token };
      if (name === "./config") return { API_BASE_URL: "https://asta.invalid" };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  };
  vm.runInNewContext(compiled, context, { filename: "http.ts" });
  t.after(() => { for (const timer of timers) clearTimeout(timer); });
  return { ...module.exports, calls, disk, setToken: (next) => { token = next; } };
}

test("saved browsing content paints before the network finishes and is revalidated on launch", async (t) => {
  const network = deferred();
  const saved = { races: [{ id: "saved-race" }] };
  const current = { races: [{ id: "current-race" }] };
  const app = fixture(t, { savedPreview: preview("account-a", saved), fetch: () => network.promise });
  const painted = [];
  let settled = false;
  const pending = app.request(RACES, { onCached: (value) => painted.push(plain(value)) });
  pending.then(() => { settled = true; });
  await tick();
  assert.deepEqual(painted, [saved]);
  assert.equal(settled, false, "preview must not replace the current-data request");
  assert.equal(app.calls.length, 1, "even an unexpired disk entry must revalidate after launch");
  network.resolve(response(current));
  assert.deepEqual(plain(await pending), current);
  assert.deepEqual(plain(await app.request(RACES)), current);
  assert.equal(app.calls.length, 1, "subsequent reads reuse the fresh in-memory result");
});

test("disk previews and in-memory results cannot leak to another account or a signed-out user", async (t) => {
  const aData = { races: [{ id: "account-a-private-race" }] };
  const app = fixture(t, {
    token: "account-b",
    savedPreview: preview("account-a", aData),
    fetch: async (_url, init) => response({ owner: init.headers.Authorization ?? "anonymous" }),
  });
  const painted = [];
  assert.deepEqual(plain(await app.request(RACES, { onCached: (value) => painted.push(value) })), { owner: "Bearer account-b" });
  assert.equal(painted.length, 0, "another account's disk preview must be ignored");
  app.setToken("account-c");
  assert.deepEqual(plain(await app.request(RACES, { onCached: (value) => painted.push(value) })), { owner: "Bearer account-c" });
  app.setToken(null);
  assert.deepEqual(plain(await app.request(RACES, { onCached: (value) => painted.push(value) })), { owner: "anonymous" });
  assert.equal(painted.length, 0, "account changes must not reuse another account's memory cache");
  assert.equal(app.calls.length, 3);
});

test("concurrent account requests stay separate and an old account response is not cached", async (t) => {
  const first = deferred();
  const second = deferred();
  const app = fixture(t, { fetch: (_url, init) => init.headers.Authorization === "Bearer account-a" ? first.promise : second.promise });
  const pendingA = app.request(RACES);
  await tick();
  app.setToken("account-b");
  const pendingB = app.request(RACES);
  await tick();
  assert.equal(app.calls.length, 2);
  first.resolve(response({ owner: "a" }));
  second.resolve(response({ owner: "b" }));
  await Promise.all([pendingA, pendingB]);
  assert.deepEqual(plain(await app.request(RACES)), { owner: "b" });
  assert.equal(app.calls.length, 2);
  app.setToken("account-a");
  await app.request(RACES);
  assert.equal(app.calls.length, 3, "the late account-a result must not become a reusable cache entry");
});

test("concurrent reads, including forced reloads, share one network request", async (t) => {
  const first = deferred();
  const reload = deferred();
  let count = 0;
  const app = fixture(t, { fetch: () => (++count === 1 ? first.promise : reload.promise) });
  const initial = [app.request(RACES), app.request(RACES), app.request(RACES, { cacheMode: "reload" })];
  await tick();
  assert.equal(app.calls.length, 1);
  first.resolve(response({ version: 1 }));
  assert.deepEqual(plain(await Promise.all(initial)), [{ version: 1 }, { version: 1 }, { version: 1 }]);
  const refreshing = [app.request(RACES, { cacheMode: "reload" }), app.request(RACES, { cacheMode: "reload" })];
  await tick();
  assert.equal(app.calls.length, 2, "reload bypasses a fresh result but still deduplicates pending reloads");
  reload.resolve(response({ version: 2 }));
  assert.deepEqual(plain(await Promise.all(refreshing)), [{ version: 2 }, { version: 2 }]);
  assert.deepEqual(plain(await app.request(RACES)), { version: 2 });
  assert.equal(app.calls.length, 2);
});

test("successful mutations invalidate disk, memory, and reads started before the mutation", async (t) => {
  const stale = deferred();
  const fresh = deferred();
  let reads = 0;
  const app = fixture(t, {
    savedPreview: preview("account-a", { version: "disk" }),
    fetch: async (_url, init) => {
      if (init.method === "POST") return response({ saved: true });
      reads += 1;
      if (reads === 1) return response({ version: "cached" });
      return reads === 2 ? stale.promise : fresh.promise;
    },
  });
  await app.request(RACES);
  const staleRead = app.request(RACES, { cacheMode: "reload" });
  await tick();
  await app.request("/races/example/enter", { method: "POST", body: "{}" });
  assert.equal(app.disk.has(PREVIEW_KEY), false);
  const previewsAfterMutation = [];
  const currentRead = app.request(RACES, { onCached: (value) => previewsAfterMutation.push(value) });
  await tick();
  assert.equal(reads, 3, "post-mutation read must not join a pre-mutation request");
  assert.equal(previewsAfterMutation.length, 0, "pre-mutation cache must no longer paint");
  fresh.resolve(response({ version: "fresh" }));
  assert.deepEqual(plain(await currentRead), { version: "fresh" });
  stale.resolve(response({ version: "stale" }));
  await staleRead;
  assert.deepEqual(plain(await app.request(RACES)), { version: "fresh" }, "late stale response must not overwrite post-mutation data");
  assert.equal(reads, 3);
});

test("expired or non-browsing disk entries never paint", async (t) => {
  const expired = fixture(t, { savedPreview: preview("account-a", { private: true }, Date.now() - 1) });
  const painted = [];
  await expired.request(RACES, { onCached: (value) => painted.push(value) });
  const wallet = fixture(t, { savedPreview: JSON.stringify({ owner: "account-a", entries: [["/wallet", { expiresAt: Date.now() + 30_000, previewUntil: Date.now() + 60_000, value: { balance: 99 } }]] }) });
  await wallet.request("/wallet", { onCached: (value) => painted.push(value) });
  assert.equal(painted.length, 0);
});

test("timeout remains active while the response body is stalled", { timeout: 1500 }, async (t) => {
  let bodyStarted = false;
  let abortedDuringBody = false;
  const app = fixture(t, { fetch: async (_url, init) => ({
    ok: true,
    status: 200,
    json: () => new Promise((_resolve, reject) => {
      bodyStarted = true;
      const abort = () => {
        abortedDuringBody = true;
        const error = new Error("The operation was aborted");
        error.name = "AbortError";
        reject(error);
      };
      if (init.signal.aborted) abort();
      else init.signal.addEventListener("abort", abort, { once: true });
    }),
  }) });
  const started = Date.now();
  await assert.rejects(app.request(RACES, { timeoutMs: 25 }), (error) => {
    assert.equal(error.isNetworkError, true);
    assert.match(error.message, /taking longer than expected/);
    return true;
  });
  assert.equal(bodyStarted, true);
  assert.equal(abortedDuringBody, true);
  assert.ok(Date.now() - started < 1000, "body reads must be covered by the request deadline");
  assert.equal(app.calls.length, 1, "explicit timeout does not start the default automatic retry");
});
