import { test } from "node:test";
import assert from "node:assert/strict";
import { BrowserEmailScraper } from "../src/infrastructure/scraper/BrowserEmailScraper.js";

test("BrowserEmailScraper launches the browser via injected engine once (singleton)", async () => {
  let launches = 0;
  const engine = {
    supportsBrowser: true,
    async launchBrowser({ headless }) {
      launches++;
      assert.equal(headless, true);
      return { async close() {} };
    },
  };
  const s = new BrowserEmailScraper({ headless: true, engine });
  const b1 = await s._launchForTest();
  const b2 = await s._launchForTest();
  assert.equal(launches, 1); // singleton
  assert.equal(b1, b2);
  await s.close();
});
