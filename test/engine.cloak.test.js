import { test } from "node:test";
import assert from "node:assert/strict";
import { CloakBrowserEngine } from "../src/infrastructure/engine/CloakBrowserEngine.js";

const ARGS = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"];

test("cloak engine launchBrowser delegates to cloak launch with stealth args", async () => {
  let called = null;
  const fakeLaunch = async (opts) => {
    called = opts;
    return { async newPage() { return { async goto() {}, async content() { return "<html>cloak</html>"; }, url() { return "https://x.com"; }, async close() {} }; }, async close() {} };
  };
  const e = new CloakBrowserEngine({ launchImpl: fakeLaunch });
  assert.equal(e.name, "cloakbrowser");
  assert.equal(e.supportsBrowser, true);
  const b = await e.launchBrowser({ headless: true });
  assert.equal(called.headless, true);
  assert.deepEqual(called.args, ARGS); // env pode ou não estar presente (depende do ambiente)
  await b.close();
});

test("cloak engine fetchHtml renders via a stealth page", async () => {
  const fakeLaunch = async () => ({
    async newPage() { return { async goto() {}, async content() { return "<html>cloak</html>"; }, url() { return "https://x.com/final"; }, async close() {} }; },
    async close() {},
  });
  const e = new CloakBrowserEngine({ launchImpl: fakeLaunch });
  const r = await e.fetchHtml("https://x.com");
  assert.match(r.html, /cloak/);
  assert.equal(r.finalUrl, "https://x.com/final");
  assert.equal(r.status, 200);
  await e.close();
});
