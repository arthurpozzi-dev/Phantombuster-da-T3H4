import { test } from "node:test";
import assert from "node:assert/strict";
import { createJobCache, cacheKey } from "../src/application/jobCache.js";

test("cacheKey normalizes protocol, host case and trailing slash", () => {
  assert.equal(cacheKey("EXAMPLE.com/"), "https://example.com");
  assert.equal(cacheKey("https://Example.com/path/#frag"), "https://example.com/path");
  assert.equal(cacheKey(""), "");
});

test("run memoizes the resolved promise per key (factory runs once)", async () => {
  const cache = createJobCache();
  let calls = 0;
  const factory = async () => { calls++; return "v"; };
  const a = await cache.page.run("k", factory);
  const b = await cache.page.run("k", factory);
  assert.equal(a, "v");
  assert.equal(b, "v");
  assert.equal(calls, 1);
});

test("run shares a single in-flight promise for concurrent callers", async () => {
  const cache = createJobCache();
  let calls = 0;
  const factory = () => { calls++; return new Promise((r) => setTimeout(() => r("x"), 10)); };
  const [a, b] = await Promise.all([cache.cwv.run("k", factory), cache.cwv.run("k", factory)]);
  assert.equal(a, "x");
  assert.equal(b, "x");
  assert.equal(calls, 1);
});

test("rejection clears the entry so a later call retries", async () => {
  const cache = createJobCache();
  let calls = 0;
  const factory = async () => { calls++; if (calls === 1) throw new Error("boom"); return "ok"; };
  await assert.rejects(() => cache.search.run("k", factory), /boom/);
  const v = await cache.search.run("k", factory);
  assert.equal(v, "ok");
  assert.equal(calls, 2);
});
