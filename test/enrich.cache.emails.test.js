import { test } from "node:test";
import assert from "node:assert/strict";
import { enrichEmails } from "../src/application/enrichEmails.js";
import { createJobCache } from "../src/application/jobCache.js";

test("pageCache fetches a shared site once across leads", async () => {
  const calls = new Map();
  const emailScraper = {
    async scrapeContacts(url) {
      calls.set(url, (calls.get(url) || 0) + 1);
      return { emails: ["a@a.com"], socials: [], pagesVisited: 1 };
    },
  };
  const cache = createJobCache();
  const leads = [
    { nome: "A", site: "https://shared.com", site_emails: "" },
    { nome: "B", site: "https://shared.com", site_emails: "" },
  ];
  const out = await enrichEmails(leads, emailScraper, undefined, { pageCache: cache.page });
  assert.equal([...calls.values()].reduce((a, b) => a + b, 0), 1); // one network call total
  assert.equal(out.ok, 2);
});
