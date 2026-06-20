import { test } from "node:test";
import assert from "node:assert/strict";
import { createJobCache, createCwvCache, cacheKey } from "../src/application/jobCache.js";

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

test("createCwvCache retains the resolved value within the TTL (no re-run)", async () => {
  let t = 0;
  const cache = createCwvCache({ ttlMs: 1000, now: () => t });
  let calls = 0;
  const factory = async () => { calls++; return "report"; };
  assert.equal(await cache.run("dom", factory), "report");
  t = 500; // dentro do TTL
  assert.equal(await cache.run("dom", factory), "report");
  assert.equal(calls, 1); // serviu do cache, não reanalisou
});

test("createCwvCache: run() lazily evicts the re-read key once expired", async () => {
  let t = 0;
  const cache = createCwvCache({ ttlMs: 1000, now: () => t });
  let calls = 0;
  const factory = async () => { calls++; return "report" + calls; };
  await cache.run("dom", factory);
  t = 1000; // atingiu o TTL: a releitura deve reanalisar
  assert.equal(await cache.run("dom", factory), "report2");
  assert.equal(calls, 2);
});

test("createCwvCache: sweep() removes cold expired entries that are never re-read", async () => {
  let t = 0;
  const cache = createCwvCache({ ttlMs: 1000, now: () => t });
  // Insere duas entradas em instantes diferentes.
  await cache.run("a", async () => "ra");
  t = 600;
  await cache.run("b", async () => "rb");

  t = 1200; // "a" (at=0) expirou; "b" (at=600) ainda é válida
  cache.sweep();

  // "b" ainda serve do cache sem reanalisar...
  let bCalls = 0;
  assert.equal(await cache.run("b", async () => { bCalls++; return "rb2"; }), "rb");
  assert.equal(bCalls, 0);
  // ...mas "a" foi evictada pelo sweep, então reanalisaria.
  let aCalls = 0;
  await cache.run("a", async () => { aCalls++; return "ra2"; });
  assert.equal(aCalls, 1);
});
