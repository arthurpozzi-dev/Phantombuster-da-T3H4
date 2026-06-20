import { test } from "node:test";
import assert from "node:assert/strict";
import { enrichEmails } from "../src/application/enrichEmails.js";
import { createJobCache } from "../src/application/jobCache.js";

test("anti-ban tier retries ONLY sites the native fetch could not load", async () => {
  const nativeCalls = [];
  const engineCalls = [];
  const emailScraper = {
    async scrapeContacts(url) {
      nativeCalls.push(url);
      if (url.includes("blocked")) throw new Error("HTTP 403"); // Cloudflare-ish
      return { emails: ["ok@ok.com"], socials: [], pagesVisited: 1 };
    },
  };
  const engineScraper = {
    async scrapeContacts(url) {
      engineCalls.push(url);
      return { emails: ["unblocked@blocked.com"], socials: [], pagesVisited: 1 };
    },
  };
  const leads = [
    { nome: "Ok", site: "https://ok.com", site_emails: "" },
    { nome: "Blocked", site: "https://blocked.com", site_emails: "" },
  ];
  const out = await enrichEmails(leads, emailScraper, undefined, { engineScraper });

  // Tier 2 só toca o site bloqueado, não o que já carregou.
  assert.deepEqual(engineCalls, ["https://blocked.com"]);
  assert.equal(out.antiBan, 1);
  assert.equal(out.ok, 2);
  assert.equal(out.falhas, 0);
  const blocked = out.leads.find((l) => l.nome === "Blocked");
  assert.equal(blocked.site_emails, "unblocked@blocked.com");
  assert.equal(blocked.site_emails_erro, ""); // erro do fetch nativo foi limpo
});

test("anti-ban: engine LOADS a Phase-1-blocked site but finds no e-mail → semEmail, not falha", async () => {
  const emailScraper = {
    async scrapeContacts(url) {
      throw new Error("HTTP 403"); // Fase 1 bloqueia (Cloudflare-ish)
    },
  };
  const engineScraper = {
    async scrapeContacts() {
      // O engine ALCANÇA o site (não lança), mas a página não tem e-mail.
      return { emails: [], socials: [], pagesVisited: 1 };
    },
  };
  const leads = [{ nome: "Blocked", site: "https://blocked.com", site_emails: "" }];
  const out = await enrichEmails(leads, emailScraper, undefined, { engineScraper });

  const blocked = out.leads.find((l) => l.nome === "Blocked");
  assert.equal(blocked.site_emails_erro, ""); // o site carregou: erro do fetch foi limpo
  assert.equal(blocked.site_emails, "");
  assert.equal(out.antiBan, 0); // nada de e-mail recuperado
  assert.equal(out.falhas, 0); // NÃO é falha: o site é alcançável
  assert.equal(out.semEmail, 1); // carregou, só não tinha e-mail
  assert.equal(out.ok, 0);
});

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
