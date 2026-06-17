import { test } from "node:test";
import assert from "node:assert/strict";
import { PageSpeedClient } from "../src/infrastructure/pagespeed/PageSpeedClient.js";

const okResp = (capture) => async (u) => {
  capture.url = u;
  return {
    ok: true,
    status: 200,
    json: async () => ({
      lighthouseResult: { categories: { performance: { score: 0.9 } }, audits: {}, fetchTime: "t" },
      loadingExperience: {},
    }),
  };
};

test("default requests only the performance category", async () => {
  const cap = {};
  const c = new PageSpeedClient({ apiKey: "k", fetchImpl: okResp(cap) });
  const r = await c.analyze("https://x.com");
  const params = new URL(cap.url).searchParams;
  assert.deepEqual(params.getAll("category"), ["performance"]);
  assert.equal(r.score, 90);
});

test("custom categories are all requested", async () => {
  const cap = {};
  const c = new PageSpeedClient({ apiKey: "k", fetchImpl: okResp(cap), categories: ["performance", "seo"] });
  await c.analyze("https://x.com");
  const params = new URL(cap.url).searchParams;
  assert.deepEqual(params.getAll("category").sort(), ["performance", "seo"]);
});

test("default timeout is 45s", () => {
  const c = new PageSpeedClient({ apiKey: "k" });
  assert.equal(c.timeoutMs, 45000);
});
