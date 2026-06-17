import { test } from "node:test";
import assert from "node:assert/strict";
import { PlaywrightEngine } from "../src/infrastructure/engine/PlaywrightEngine.js";

test("playwright engine fetchHtml maps response to contract", async () => {
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    url: "https://x.com/final",
    text: async () => "<h1>ok</h1>",
    headers: new Map([["content-type", "text/html"]]),
  });
  const e = new PlaywrightEngine({ fetchImpl: fakeFetch });
  const r = await e.fetchHtml("https://x.com");
  assert.equal(e.name, "playwright");
  assert.equal(e.supportsBrowser, true);
  assert.equal(r.status, 200);
  assert.equal(r.finalUrl, "https://x.com/final");
  assert.match(r.html, /ok/);
});
