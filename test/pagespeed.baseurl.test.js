import { test } from "node:test";
import assert from "node:assert/strict";
import { PageSpeedClient } from "../src/infrastructure/pagespeed/PageSpeedClient.js";

const respond = (cap, body) => async (u) => {
  cap.url = u;
  return { ok: true, status: 200, json: async () => body };
};

test("baseUrl redirects the request to the self-hosted instance", async () => {
  const cap = {};
  const body = { lighthouseResult: { categories: { performance: { score: 0.8 } }, audits: {}, fetchTime: "t" } };
  const c = new PageSpeedClient({ baseUrl: "https://lh.local/run", fetchImpl: respond(cap, body) });
  const r = await c.analyze("https://x.com");
  assert.ok(cap.url.startsWith("https://lh.local/run?"), `unexpected url: ${cap.url}`);
  assert.equal(r.score, 80);
});

test("parses a bare lhr body (no PageSpeed envelope)", async () => {
  const cap = {};
  const lhr = {
    categories: { performance: { score: 0.55 }, seo: { score: 0.9 } },
    audits: { "largest-contentful-paint": { displayValue: "2.0 s", numericValue: 2000, score: 0.9 } },
    fetchTime: "t",
  };
  const c = new PageSpeedClient({ baseUrl: "https://lh.local/run", fetchImpl: respond(cap, lhr) });
  const r = await c.analyze("https://x.com");
  assert.equal(r.score, 55);
  assert.equal(r.categories.seo, 90);
  assert.equal(r.metrics.lcp.display, "2.0 s");
  assert.equal(r.field, null); // sem loadingExperience no lhr cru
});

test("default endpoint is still used when no baseUrl", async () => {
  const cap = {};
  const body = { lighthouseResult: { categories: { performance: { score: 0.9 } }, audits: {}, fetchTime: "t" }, loadingExperience: {} };
  const c = new PageSpeedClient({ apiKey: "k", fetchImpl: respond(cap, body) });
  await c.analyze("https://x.com");
  assert.ok(cap.url.startsWith("https://www.googleapis.com/pagespeedonline/v5/runPagespeed?"), `unexpected url: ${cap.url}`);
});
