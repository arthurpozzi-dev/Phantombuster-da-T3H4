# CWV Enrichment Acceleration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CWV enrichment dramatically faster by querying CrUX field data first, running a trimmed (performance-only) Lighthouse as fallback, and deferring the full 4-category Lighthouse to report-time — with a UI toggle for deep bulk analysis.

**Architecture:** Add a `CruxClient` (real-user field data, ~300ms). `enrichLeads` tries CrUX first; if a site has field data, it derives `cwv_score`/`cwv_status` without a Lighthouse run. Otherwise it runs `PageSpeedClient` with `category=performance` only (much faster), 45s timeout, higher concurrency. The full 4-category Lighthouse + opportunities runs only when the persuasive report is generated, or when the user enables a "deep analysis" toggle in the UI. The 12s serial health check is removed from the hot path.

**Tech Stack:** Node ESM, Google CrUX API + PageSpeed Insights API v5, `node --test`.

## Global Constraints

- Node ESM modules; keep files under 500 lines.
- Reuse the existing PageSpeed API key (`PAGESPEED_API_KEY` env / `?key=` param) for CrUX — same Google API key works for both.
- Default bulk behavior = fast path (CrUX-first → perf-only Lighthouse). Deep (4 categories) only via `?deep=1` / UI toggle.
- The persuasive report (`/api/report/:id/lead/...`) MUST always have a full report; if the lead was enriched in fast mode, generate the full Lighthouse on report render.
- Preserve all existing `cwv_*` output column names in `EnrichLeads.js`; fields not measured in fast mode are emitted as `""` (empty), never `undefined`.
- Per-item errors stay tolerated (status `N/A`, reason in `cwv_erro`) — never throw out of the pool.

---

### Task 1: CruxClient

**Files:**
- Create: `src/infrastructure/pagespeed/CruxClient.js`
- Test: `test/crux.test.js`

**Interfaces:**
- Produces: `class CruxClient` with ctor `{ apiKey, strategy="PHONE", timeoutMs=8000, fetchImpl? }` and `async query(url) -> { hasField: boolean, overall: string|null, lcp, inp, cls, fcp, ttfb, score: number|null } | null`. Each metric is `{ p75: number|null, category: "good"|"needs-improvement"|"poor"|null }`. `score` is a 0–100 heuristic derived from CWV pass/fail (see Step 3). Returns `{hasField:false,...}` when the URL has no CrUX sample (HTTP 404 from the API).

- [ ] **Step 1: Write the test** with an injected fetch returning a CrUX-shaped payload.

```js
import { test } from "node:test"; import assert from "node:assert/strict";
import { CruxClient } from "../src/infrastructure/pagespeed/CruxClient.js";

const sample = { record: { metrics: {
  largest_contentful_paint: { percentiles: { p75: 2200 }, histogram: [{}] },
  interaction_to_next_paint: { percentiles: { p75: 180 } },
  cumulative_layout_shift: { percentiles: { p75: 0.05 } },
}, key: {} } };

test("crux query maps field metrics + derives score", async () => {
  const fakeFetch = async () => ({ ok: true, status: 200, json: async () => sample });
  const c = new CruxClient({ apiKey: "k", fetchImpl: fakeFetch });
  const r = await c.query("https://x.com");
  assert.equal(r.hasField, true);
  assert.equal(r.lcp.p75, 2200); assert.equal(r.lcp.category, "good");      // <2500
  assert.equal(r.cls.category, "good");                                       // <0.1
  assert.equal(typeof r.score, "number");
});

test("crux returns hasField:false on 404 (no sample)", async () => {
  const fakeFetch = async () => ({ ok: false, status: 404, json: async () => ({ error: {} }) });
  const c = new CruxClient({ apiKey: "k", fetchImpl: fakeFetch });
  const r = await c.query("https://no-traffic.com");
  assert.equal(r.hasField, false);
});
```

- [ ] **Step 2: Run** `node --test test/crux.test.js` → FAIL (module missing).

- [ ] **Step 3: Implement `CruxClient.js`.** Endpoint `https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=<apiKey>`, POST `{ url, formFactor: strategy }`. Thresholds: LCP good <2500ms / poor >4000; INP good <200 / poor >500; CLS good <0.1 / poor >0.25. Score heuristic: start 100, subtract 25 per non-"good" core metric (LCP/INP/CLS), floor 0.

```js
const ENDPOINT = "https://chromeuxreport.googleapis.com/v1/records:queryRecord";
const cat = (v, good, poor) => v == null ? null : v <= good ? "good" : v <= poor ? "needs-improvement" : "poor";
const metric = (m, good, poor) => { const p75 = m?.percentiles?.p75 ?? null; return { p75, category: cat(p75, good, poor) }; };

export class CruxClient {
  constructor({ apiKey, strategy = "PHONE", timeoutMs = 8000, fetchImpl } = {}) {
    this.apiKey = apiKey || process.env.PAGESPEED_API_KEY || "";
    this.strategy = strategy; this.timeoutMs = timeoutMs; this._fetch = fetchImpl || globalThis.fetch;
  }
  async query(url) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this._fetch(`${ENDPOINT}?key=${encodeURIComponent(this.apiKey)}`, {
        method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ url, formFactor: this.strategy }) });
      if (res.status === 404) return { hasField: false, overall: null, lcp: null, inp: null, cls: null, fcp: null, ttfb: null, score: null };
      if (!res.ok) throw new Error(`CrUX HTTP ${res.status}`);
      const data = await res.json(); const m = data?.record?.metrics || {};
      const lcp = metric(m.largest_contentful_paint, 2500, 4000);
      const inp = metric(m.interaction_to_next_paint, 200, 500);
      const cls = metric(m.cumulative_layout_shift, 0.1, 0.25);
      const fcp = metric(m.first_contentful_paint, 1800, 3000);
      const ttfb = metric(m.experimental_time_to_first_byte, 800, 1800);
      let score = 100; for (const x of [lcp, inp, cls]) if (x.category && x.category !== "good") score -= 25;
      score = Math.max(0, score);
      const overall = score >= 90 ? "FAST" : score >= 50 ? "AVERAGE" : "SLOW";
      return { hasField: true, overall, lcp, inp, cls, fcp, ttfb, score };
    } finally { clearTimeout(timer); }
  }
}
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** `git add src/infrastructure/pagespeed/CruxClient.js test/crux.test.js && git commit -m "feat(cwv): CrUX field-data client"`

---

### Task 2: PageSpeedClient gains a categories option + faster defaults

**Files:**
- Modify: `src/infrastructure/pagespeed/PageSpeedClient.js`
- Test: `test/pagespeed.categories.test.js`

**Interfaces:**
- Produces: `new PageSpeedClient({ apiKey, strategy, timeoutMs=45000, maxRetries=1, categories=["performance"] })`. `analyze(url)` requests only the configured categories. Default timeout drops 90s→45s.

- [ ] **Step 1: Write the test** — inject a fetch capturing the request URL; assert that with default ctor only `category=performance` is present, and with `categories:["performance","seo"]` both appear.

```js
import { test } from "node:test"; import assert from "node:assert/strict";
import { PageSpeedClient } from "../src/infrastructure/pagespeed/PageSpeedClient.js";
const okResp = (capture) => async (u) => { capture.url = u; return { ok: true, status: 200,
  json: async () => ({ lighthouseResult: { categories: { performance: { score: 0.9 } }, audits: {}, fetchTime: "t" }, loadingExperience: {} }) }; };
test("default requests only performance category", async () => {
  const cap = {}; const c = new PageSpeedClient({ apiKey: "k", fetchImpl: okResp(cap) });
  await c.analyze("https://x.com");
  const params = new URL(cap.url).searchParams; assert.deepEqual(params.getAll("category"), ["performance"]);
});
```

- [ ] **Step 2: Run** → FAIL (no `fetchImpl` support / categories not configurable yet).

- [ ] **Step 3: Modify `PageSpeedClient.js`.** (a) Add `categories = ["performance"]` and optional `fetchImpl` to the constructor; store `this.categories`, `this._fetch = fetchImpl || globalThis.fetch`; change default `timeoutMs` to `45000`. (b) In `_attempt`, replace the module-level `CATEGORIES` loop with `for (const c of this.categories) params.append("category", c);` and use `this._fetch` instead of global `fetch`. Keep `buildReport`, retry, and abort logic intact (categories absent from the response simply yield `null` scores, which `buildReport` already tolerates).

- [ ] **Step 4: Run** → PASS, plus `npm test`.

- [ ] **Step 5: Commit** `git commit -am "feat(cwv): configurable categories + 45s default timeout in PageSpeedClient"`

---

### Task 3: enrichLeads CrUX-first orchestration + deep flag + drop serial healthcheck

**Files:**
- Modify: `src/application/EnrichLeads.js`
- Test: `test/enrich.cruxfirst.test.js`

**Interfaces:**
- Consumes: `cruxClient.query(url)` (Task 1), `pageSpeedClient.analyze(url)` (Task 2).
- Produces: `enrichLeads(comSite, pageSpeedClient, onProgress, options)` where `options` gains `{ cruxClient, deep=false, concurrency }`. Fast path: CrUX hit → fill score/status/field columns, skip Lighthouse. Miss → Lighthouse (perf-only unless `deep`). `deep:true` always runs the full Lighthouse (caller passes a 4-category `PageSpeedClient`). Health check is no longer serial-before-every-lead.

- [ ] **Step 1: Write the test** — with a `cruxClient` returning `hasField:true` for site A and `hasField:false` for site B, assert A is scored from CrUX (PageSpeed NOT called) and B falls back to PageSpeed.

```js
import { test } from "node:test"; import assert from "node:assert/strict";
import { enrichLeads } from "../src/application/EnrichLeads.js";
test("CrUX hit skips Lighthouse; miss falls back", async () => {
  const crux = { query: async (u) => u.includes("a.com") ? { hasField: true, overall: "FAST", score: 95, lcp:{p75:2000,category:"good"}, inp:null, cls:{p75:0.02,category:"good"}, fcp:null, ttfb:null } : { hasField: false, score: null } };
  let psCalls = 0;
  const ps = { analyze: async () => { psCalls++; return { score: 40, categories:{}, metrics:{ lcp:{display:"4s"},fcp:{},cls:{},tbt:{},si:{},tti:{} }, field:null, opportunities:[] }; } };
  const leads = [{ nome:"A", site:"https://a.com" }, { nome:"B", site:"https://b.com" }];
  const out = await enrichLeads(leads, ps, undefined, { cruxClient: crux });
  assert.equal(psCalls, 1);                                  // only B hit PageSpeed
  const a = out.leads.find(l => l.nome === "A");
  assert.equal(a.cwv_score, 95); assert.equal(a.cwv_campo, "FAST");
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Modify `EnrichLeads.js`.** Add `const cruxClient = options.cruxClient; const deep = !!options.deep;`. Inside the pool task, replace the serial `healthChecker.check` block with the CrUX-first logic:

```js
// 1) CrUX field data first (fast). Only when not in deep mode.
if (cruxClient && !deep) {
  try {
    const f = await cruxClient.query(lead.site);
    if (f && f.hasField) {
      ok++;
      return { ...lead, cwv_score: f.score, cwv_status: classifyCwv(f.score), cwv_erro: "",
        cwv_lcp: f.lcp?.p75 != null ? `${f.lcp.p75} ms` : "", cwv_fcp: f.fcp?.p75 != null ? `${f.fcp.p75} ms` : "",
        cwv_cls: f.cls?.p75 != null ? String(f.cls.p75) : "", cwv_tbt: "", cwv_si: "", cwv_tti: "",
        score_acessibilidade: "", score_boas_praticas: "", score_seo: "",
        audit_score: "", cwv_oportunidades: "", cwv_campo: f.overall || "", cwv_report: null };
    }
  } catch { /* CrUX falhou: cai pro Lighthouse */ }
}
// 2) Lighthouse fallback (perf-only in fast mode; full when deep).
try {
  const report = await pageSpeedClient.analyze(lead.site);
  /* ...existing success mapping unchanged... */
} catch (e) { falhas++; return { ...lead, cwv_score: null, cwv_status: "N/A", cwv_erro: e?.message || "falha" }; }
```

Keep the existing success-mapping block (lines 52-76) exactly as-is for the Lighthouse path. Remove the `healthChecker` serial pre-check (it added 12s/lead); leave `options.healthChecker` accepted-but-unused for compatibility, or wire an optional 3s HEAD inside the catch to label "FORA DO AR" — keep it OUT of the hot path.

- [ ] **Step 4: Run** → PASS, plus `npm test`.

- [ ] **Step 5: Commit** `git commit -am "feat(cwv): CrUX-first enrich, deep flag, drop serial healthcheck"`

---

### Task 4: Server wires CrUX client, deep flag, higher concurrency

**Files:**
- Modify: `src/infrastructure/http/server.js`
- Modify: `src/main.js`
- Test: `test/server.enrich.test.js`

**Interfaces:**
- Consumes: `CruxClient` (Task 1), `enrichLeads` options (Task 3).
- Produces: `/api/enrich/:id` reads `deep` (0/1) and `conc`; builds a perf-only or 4-category `PageSpeedClient` accordingly; passes a `cruxClient` into `enrichLeads`. Default concurrency raised to 12.

- [ ] **Step 1: Write the test** — hit `/api/enrich/:id?deep=1` against a stubbed use-case layer; assert a 4-category client path is selected (assert via a spy that the PageSpeedClient was built with `categories.length === 4`). Keep it light (stub the heavy bits).

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Modify `main.js`** to construct and inject a `CruxClient`: `import { CruxClient } from "./infrastructure/pagespeed/CruxClient.js";` and pass `makeCruxClient = (apiKey) => new CruxClient({ apiKey })` (or a singleton) into `createServer`. **Modify `server.js`** `/api/enrich` handler: read `const deep = req.query.deep === "1"; const conc = Number(req.query.conc) || Number(process.env.ENRICH_CONCURRENCY) || 12;`. Build the PageSpeed client with `categories: deep ? ["performance","accessibility","best-practices","seo"] : ["performance"]`. Build the CrUX client from the same `key`. Call `enrichLeads(comSite, psClient, onProgress, { cruxClient, deep, concurrency: conc })`.

- [ ] **Step 4: Run** → PASS, plus `npm test`.

- [ ] **Step 5: Commit** `git commit -am "feat(cwv): server wires CrUX + deep + conc=12"`

---

### Task 5: UI deep-analysis toggle

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`

**Interfaces:**
- Produces: a checkbox `#deepCwv`; when checked, `/api/enrich` is called with `deep=1`.

- [ ] **Step 1: Add the control** to `index.html` near the enrich key/conc inputs:

```html
<label title="Roda Lighthouse completo (acessibilidade, SEO, boas práticas) em todos — mais lento">
  <input type="checkbox" id="deepCwv"> Análise profunda (mais lenta)
</label>
```

- [ ] **Step 2: Wire in `app.js`** `enrich()` (line ~411): append `if ($("deepCwv").checked) params.set("deep", "1");` (and keep sending `conc`). Update the status copy to mention "modo rápido (CrUX)" vs "profundo" based on the checkbox.

- [ ] **Step 3: Manual verification** (documented): `npm start`, enrich a small list without the toggle → fast; with the toggle → all category columns populate.

- [ ] **Step 4: Commit** `git commit -am "feat(ui): deep CWV analysis toggle"`

---

### Task 6: Report-time full Lighthouse guarantee

**Files:**
- Modify: `src/infrastructure/http/server.js` (report route) and/or `src/application/buildAuditReportModel.js`
- Test: `test/report.fulllighthouse.test.js`

**Interfaces:**
- Consumes: a 4-category `PageSpeedClient`.
- Produces: when rendering `/api/report/:id/lead/:b/:i.html`, if the lead's `cwv_report` is `null` (fast-mode enrich) or missing categories, run a full 4-category `analyze(lead.site)` on the fly and use that for the report. Cache the result back onto the in-memory lead so repeat renders are instant.

- [ ] **Step 1: Write the test** — a lead with `cwv_report:null`; render the report; assert the full PageSpeed client was invoked once and the rendered model has category scores. (Stub the renderer to capture the model.)

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.** In the report handler, before building the audit model: `if (!lead.cwv_report) { try { lead.cwv_report = await fullPageSpeed.analyze(lead.site); } catch { /* render with whatever exists */ } }`. `fullPageSpeed` is a 4-category `PageSpeedClient` built from the env/key. Then proceed with the existing `buildAuditReportModel`/render flow.

- [ ] **Step 4: Run** → PASS, plus `npm test`.

- [ ] **Step 5: Commit** `git commit -am "feat(cwv): ensure full Lighthouse at report render time"`

---

## Self-Review Notes

- Spec §4.2 step 1 (CrUX-first) → Task 1+3. Step 2 (trimmed Lighthouse) → Task 2+4. Step 3 (lazy full Lighthouse) → Task 6. Step 4 (healthcheck) → Task 3. §4.3 (UI toggle) → Task 5. All covered.
- Column compatibility: Task 3 emits every existing `cwv_*`/`score_*` key, using `""` for fields not measured in fast mode (Global Constraints) — no `undefined`, no schema break for the exporter.
- Type consistency: `CruxClient.query -> {hasField, overall, lcp{p75,category}, ..., score}` consumed exactly that way in Task 3; `PageSpeedClient` `categories` array used identically in Tasks 2/4/6.
- Independent of the engines plan: this plan touches only pagespeed/enrich/report; no shared files conflict beyond `main.js` and `server.js` (additive edits in distinct handlers).
```
