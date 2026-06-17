# Selectable Scraping Engines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user pick the scraping engine (Playwright / CloakBrowser / Scrapling) in the UI, applied to both Google Maps scraping and third-party site enrichment.

**Architecture:** Introduce an `Engine` abstraction with two capabilities — `fetchHtml(url, opts)` (HTTP layer) and `launchBrowser(opts)` (live Playwright Browser). Playwright and CloakBrowser implement both (CloakBrowser is a drop-in `Browser` provider in Node); Scrapling implements `fetchHtml` via a Python sidecar and reports `supportsBrowser=false`. Scrapers stop importing `chromium` directly and receive an injected engine. The server resolves the engine per request from a query param; default stays `playwright` so current behavior is unchanged.

**Tech Stack:** Node ESM, Playwright 1.61, `cloakbrowser` (npm) + `playwright-core`, Python ≥3.10 + `scrapling[fetchers]` + FastAPI/uvicorn (sidecar), `node --test`.

## Global Constraints

- Node ESM modules (`"type": "module"`); no CommonJS.
- Keep files under 500 lines; one responsibility per file.
- Validate input at boundaries (server query params).
- Default engine MUST be `playwright` — omitting the UI selector reproduces today's behavior exactly.
- CloakBrowser requires Node ≥20 and `playwright-core` ≥1.53 (project has playwright 1.61 ✓).
- Scrapling sidecar binds to `127.0.0.1` only; never expose externally.
- Lazy-load engine deps: `import("cloakbrowser")` and sidecar spawn happen only when that engine is selected.
- Engine `fetchHtml` return shape is the contract: `{ html: string, status: number, finalUrl: string }`.
- Engine `launchBrowser` returns a Playwright-compatible `Browser` (has `newContext`, `newPage`, `close`).

---

### Task 1: Engine interface, FakeEngine, and shared launch options

**Files:**
- Create: `src/infrastructure/engine/Engine.js` (JSDoc typedef + `NotSupportedError`)
- Create: `src/infrastructure/engine/launchOptions.js` (extracted from GoogleMapsScraper)
- Create: `test/engine.contract.test.js`
- Create: `test/helpers/FakeEngine.js`

**Interfaces:**
- Produces: `class NotSupportedError extends Error`; `buildLaunchOptions(headless) -> LaunchOptions`; `FakeEngine` with `{ name, supportsBrowser, fetchHtml(url,opts), launchBrowser(opts), close() }`.

- [ ] **Step 1: Extract `buildLaunchOptions` into its own module.** Move the whole block `LINUX_CHROMIUM_PATHS`, `ensureLocalLibSonames`, `browserEnv`, `buildLaunchOptions` (currently `GoogleMapsScraper.js:18-109`) into `src/infrastructure/engine/launchOptions.js` and `export { buildLaunchOptions }`. In `GoogleMapsScraper.js` replace the moved code with `import { buildLaunchOptions } from "../engine/launchOptions.js";`. (BrowserEmailScraper imports `buildLaunchOptions` from GoogleMapsScraper today — update that import in Task 8.)

- [ ] **Step 2: Write `Engine.js`.**

```js
/**
 * Engine = provider de scraping com duas capacidades.
 * @typedef {Object} Engine
 * @property {string} name
 * @property {boolean} supportsBrowser
 * @property {(url:string, opts?:{timeoutMs?:number, headers?:Record<string,string>, mode?:string}) => Promise<{html:string,status:number,finalUrl:string}>} fetchHtml
 * @property {(opts?:{headless?:boolean}) => Promise<import("playwright").Browser>} launchBrowser
 * @property {() => Promise<void>} close
 */
export class NotSupportedError extends Error {
  constructor(msg) { super(msg); this.name = "NotSupportedError"; }
}
```

- [ ] **Step 3: Write `FakeEngine.js`** (test double, configurable responses).

```js
import { NotSupportedError } from "../../src/infrastructure/engine/Engine.js";
export class FakeEngine {
  constructor({ name = "fake", supportsBrowser = true, html = "<html></html>", status = 200 } = {}) {
    this.name = name; this.supportsBrowser = supportsBrowser;
    this._html = html; this._status = status; this.calls = [];
  }
  async fetchHtml(url, opts = {}) { this.calls.push({ url, opts }); return { html: this._html, status: this._status, finalUrl: url }; }
  async launchBrowser() { if (!this.supportsBrowser) throw new NotSupportedError("no browser"); return { closed: false, async close() { this.closed = true; } }; }
  async close() {}
}
```

- [ ] **Step 4: Write the contract test** (`test/engine.contract.test.js`): assert `FakeEngine.fetchHtml` returns `{html,status,finalUrl}` and records the call; assert `launchBrowser` throws `NotSupportedError` when `supportsBrowser:false`.

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeEngine } from "./helpers/FakeEngine.js";
import { NotSupportedError } from "../src/infrastructure/engine/Engine.js";

test("fetchHtml returns contract shape", async () => {
  const e = new FakeEngine({ html: "<p>hi</p>", status: 200 });
  const r = await e.fetchHtml("https://x.com");
  assert.equal(r.html, "<p>hi</p>"); assert.equal(r.status, 200); assert.equal(r.finalUrl, "https://x.com");
});
test("launchBrowser throws when unsupported", async () => {
  const e = new FakeEngine({ supportsBrowser: false });
  await assert.rejects(() => e.launchBrowser(), NotSupportedError);
});
```

- [ ] **Step 5: Run** `node --test test/engine.contract.test.js` → expect PASS. Also run full `npm test` to confirm the `buildLaunchOptions` extraction didn't break the existing pipeline test.

- [ ] **Step 6: Commit** `git add src/infrastructure/engine test/engine.contract.test.js test/helpers/FakeEngine.js src/infrastructure/scraper/GoogleMapsScraper.js && git commit -m "feat(engine): add Engine contract, FakeEngine, extract launchOptions"`

---

### Task 2: PlaywrightEngine

**Files:**
- Create: `src/infrastructure/engine/PlaywrightEngine.js`
- Test: `test/engine.playwright.test.js`

**Interfaces:**
- Consumes: `buildLaunchOptions` (Task 1).
- Produces: `class PlaywrightEngine` implementing `Engine` with `name:"playwright"`, `supportsBrowser:true`.

- [ ] **Step 1: Write the test** — `fetchHtml` uses an injected fetch impl and returns the contract shape; `name`/`supportsBrowser` correct. Inject `fetchImpl` via constructor for testability.

```js
import { test } from "node:test"; import assert from "node:assert/strict";
import { PlaywrightEngine } from "../src/infrastructure/engine/PlaywrightEngine.js";
test("playwright engine fetchHtml", async () => {
  const fakeFetch = async () => ({ ok: true, status: 200, url: "https://x.com/final", text: async () => "<h1>ok</h1>", headers: new Map([["content-type","text/html"]]) });
  const e = new PlaywrightEngine({ fetchImpl: fakeFetch });
  const r = await e.fetchHtml("https://x.com");
  assert.equal(e.name, "playwright"); assert.equal(e.supportsBrowser, true);
  assert.equal(r.status, 200); assert.equal(r.finalUrl, "https://x.com/final"); assert.match(r.html, /ok/);
});
```

- [ ] **Step 2: Run** the test → FAIL (module missing).

- [ ] **Step 3: Implement `PlaywrightEngine.js`.**

```js
import { chromium } from "playwright";
import { buildLaunchOptions } from "./launchOptions.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export class PlaywrightEngine {
  constructor({ fetchImpl } = {}) {
    this.name = "playwright"; this.supportsBrowser = true;
    this._fetch = fetchImpl || globalThis.fetch;
  }
  async fetchHtml(url, { timeoutMs = 15000, headers = {} } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await this._fetch(url, { signal: controller.signal, redirect: "follow",
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8", ...headers } });
      const html = await res.text();
      return { html, status: res.status, finalUrl: res.url || url };
    } finally { clearTimeout(timer); }
  }
  async launchBrowser({ headless = true } = {}) { return chromium.launch(buildLaunchOptions(headless)); }
  async close() {}
}
```

- [ ] **Step 4: Run** the test → PASS.

- [ ] **Step 5: Commit** `git commit -am "feat(engine): PlaywrightEngine"`

---

### Task 3: CloakBrowserEngine

**Files:**
- Create: `src/infrastructure/engine/CloakBrowserEngine.js`
- Test: `test/engine.cloak.test.js`
- Modify: `package.json` (add `cloakbrowser`, `playwright-core`)

**Interfaces:**
- Produces: `class CloakBrowserEngine` (`name:"cloakbrowser"`, `supportsBrowser:true`). Lazy `import("cloakbrowser")`.

- [ ] **Step 1: Add deps.** In `package.json` dependencies add `"cloakbrowser": "^0.3.31"` and `"playwright-core": "^1.61.0"`. Run `npm install`. (Binary auto-downloads on first launch; do not add a blocking postinstall.)

- [ ] **Step 2: Write the test** (injected `launchImpl` so we don't download the 200MB binary in CI).

```js
import { test } from "node:test"; import assert from "node:assert/strict";
import { CloakBrowserEngine } from "../src/infrastructure/engine/CloakBrowserEngine.js";
test("cloak engine launchBrowser delegates to cloak launch", async () => {
  let called = null;
  const fakeLaunch = async (opts) => { called = opts; return { async newPage(){return{ async goto(){}, async content(){return "<html>cloak</html>";}, url(){return "https://x.com";} };}, async close(){} }; };
  const e = new CloakBrowserEngine({ launchImpl: fakeLaunch });
  assert.equal(e.name, "cloakbrowser"); assert.equal(e.supportsBrowser, true);
  const b = await e.launchBrowser({ headless: true });
  assert.deepEqual(called, { headless: true, args: ["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage"] });
  await b.close();
});
test("cloak engine fetchHtml via stealth page", async () => {
  const fakeLaunch = async () => ({ async newPage(){return{ async goto(){}, async content(){return "<html>cloak</html>";}, url(){return "https://x.com/final";} };}, async close(){} });
  const e = new CloakBrowserEngine({ launchImpl: fakeLaunch });
  const r = await e.fetchHtml("https://x.com");
  assert.match(r.html, /cloak/); assert.equal(r.finalUrl, "https://x.com/final"); assert.equal(r.status, 200);
});
```

- [ ] **Step 3: Run** → FAIL.

- [ ] **Step 4: Implement `CloakBrowserEngine.js`.** Lazy-load the real `launch` if no `launchImpl` injected. Reuse one browser for `fetchHtml` calls; `launchBrowser` returns a fresh browser for the interactive scrapers.

```js
const CLOAK_ARGS = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"];

export class CloakBrowserEngine {
  constructor({ launchImpl } = {}) {
    this.name = "cloakbrowser"; this.supportsBrowser = true;
    this._launch = launchImpl || null; this._fetchBrowser = null;
  }
  async _resolveLaunch() {
    if (this._launch) return this._launch;
    const mod = await import("cloakbrowser");          // lazy: only when this engine is used
    this._launch = mod.launch;
    return this._launch;
  }
  async launchBrowser({ headless = true } = {}) {
    const launch = await this._resolveLaunch();
    return launch({ headless, args: CLOAK_ARGS });
  }
  async fetchHtml(url, { timeoutMs = 25000 } = {}) {
    const launch = await this._resolveLaunch();
    if (!this._fetchBrowser) this._fetchBrowser = await launch({ headless: true, args: CLOAK_ARGS });
    const page = await this._fetchBrowser.newPage();
    try {
      const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      return { html: await page.content(), status: resp?.status?.() ?? 200, finalUrl: page.url() };
    } finally { await page.close().catch(() => {}); }
  }
  async close() { if (this._fetchBrowser) { await this._fetchBrowser.close().catch(() => {}); this._fetchBrowser = null; } }
}
```

- [ ] **Step 5: Run** → PASS.

- [ ] **Step 6: Commit** `git commit -am "feat(engine): CloakBrowserEngine (Node-native drop-in)"`

---

### Task 4: Scrapling Python sidecar

**Files:**
- Create: `scrapling-sidecar/app.py`
- Create: `scrapling-sidecar/requirements.txt`
- Create: `scrapling-sidecar/README.md`

**Interfaces:**
- Produces: HTTP service on `127.0.0.1:<port>` with `GET /health -> {"status":"ok"}` and `POST /fetch {url, mode, timeout, network_idle?} -> {html, status, final_url}`. `mode` ∈ `fast|dynamic|stealth`.

- [ ] **Step 1: Write `requirements.txt`.**

```
scrapling[fetchers]>=0.4.9
fastapi>=0.110
uvicorn>=0.29
```

- [ ] **Step 2: Write `app.py`.** Map modes → fetchers: `fast`→`Fetcher.get`, `dynamic`→`DynamicFetcher.fetch`, `stealth`→`StealthyFetcher.fetch`. Port from `--port` arg / `SCRAPLING_SIDECAR_PORT` env.

```python
import os, sys, argparse
from fastapi import FastAPI
from pydantic import BaseModel
from scrapling.fetchers import Fetcher, DynamicFetcher, StealthyFetcher

app = FastAPI()

class FetchReq(BaseModel):
    url: str
    mode: str = "fast"
    timeout: int = 20000
    network_idle: bool = False

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/fetch")
def fetch(req: FetchReq):
    try:
        if req.mode == "stealth":
            page = StealthyFetcher.fetch(req.url, headless=True, network_idle=req.network_idle, timeout=req.timeout)
        elif req.mode == "dynamic":
            page = DynamicFetcher.fetch(req.url, headless=True, network_idle=req.network_idle, timeout=req.timeout)
        else:
            page = Fetcher.get(req.url, stealthy_headers=True, timeout=req.timeout / 1000)
        return {"html": page.html_content, "status": getattr(page, "status", 200), "final_url": req.url}
    except Exception as e:
        return {"html": "", "status": 0, "final_url": req.url, "error": str(e)}

if __name__ == "__main__":
    p = argparse.ArgumentParser(); p.add_argument("--port", type=int, default=int(os.environ.get("SCRAPLING_SIDECAR_PORT", "8765")))
    args = p.parse_args()
    import uvicorn; uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
```

- [ ] **Step 3: Write `README.md`** with setup: `python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt && scrapling install` (downloads browsers). Note Python ≥3.10. Verify the `html_content`/`status` attribute names against the installed Scrapling version (`scrapling/engines/toolbelt/custom.py`) and adjust if the local 0.4.9 differs.

- [ ] **Step 4: Manual smoke (documented, not CI):** `python app.py --port 8765 &` then `curl -s localhost:8765/health` → `{"status":"ok"}`; `curl -s -X POST localhost:8765/fetch -H 'content-type: application/json' -d '{"url":"https://example.com","mode":"fast"}' | head -c 200`.

- [ ] **Step 5: Commit** `git add scrapling-sidecar && git commit -m "feat(scrapling): python sidecar exposing fast/dynamic/stealth fetch"`

---

### Task 5: ScraplingEngine (spawns + talks to the sidecar)

**Files:**
- Create: `src/infrastructure/engine/ScraplingEngine.js`
- Test: `test/engine.scrapling.test.js`

**Interfaces:**
- Produces: `class ScraplingEngine` (`name:"scrapling"`, `supportsBrowser:false`). Ctor `{ mode="fast", port=8765, spawnImpl?, fetchImpl?, baseUrl? }`. `launchBrowser` throws `NotSupportedError`. Auto-spawns the sidecar on first `fetchHtml` (unless `baseUrl` injected) and health-checks before use.

- [ ] **Step 1: Write the test** with injected `fetchImpl` and a fixed `baseUrl` (no real spawn).

```js
import { test } from "node:test"; import assert from "node:assert/strict";
import { ScraplingEngine } from "../src/infrastructure/engine/ScraplingEngine.js";
import { NotSupportedError } from "../src/infrastructure/engine/Engine.js";
test("scrapling fetchHtml posts to sidecar and maps response", async () => {
  const fakeFetch = async (u, init) => { const body = JSON.parse(init.body);
    return { ok: true, json: async () => ({ html: `<p>${body.mode}</p>`, status: 200, final_url: body.url }) }; };
  const e = new ScraplingEngine({ mode: "stealth", baseUrl: "http://127.0.0.1:8765", fetchImpl: fakeFetch });
  const r = await e.fetchHtml("https://x.com");
  assert.equal(e.supportsBrowser, false); assert.match(r.html, /stealth/); assert.equal(r.finalUrl, "https://x.com");
});
test("scrapling launchBrowser is unsupported", async () => {
  const e = new ScraplingEngine({ baseUrl: "http://127.0.0.1:8765" });
  await assert.rejects(() => e.launchBrowser(), NotSupportedError);
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement `ScraplingEngine.js`.** When `baseUrl` is injected, skip spawning. Otherwise `spawnImpl` (default `child_process.spawn`) launches `python scrapling-sidecar/app.py --port <port>`, then poll `/health` up to ~20s. Surface a clear error if Python/Scrapling is missing.

```js
import { spawn } from "node:child_process";
import { NotSupportedError } from "./Engine.js";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class ScraplingEngine {
  constructor({ mode = "fast", port = 8765, spawnImpl, fetchImpl, baseUrl } = {}) {
    this.name = "scrapling"; this.supportsBrowser = false; this.mode = mode;
    this._port = port; this._spawn = spawnImpl || spawn; this._fetch = fetchImpl || globalThis.fetch;
    this._baseUrl = baseUrl || null; this._proc = null; this._ready = baseUrl ? Promise.resolve() : null;
  }
  async _ensure() {
    if (this._baseUrl) return;
    if (this._ready) return this._ready;
    this._ready = (async () => {
      this._baseUrl = `http://127.0.0.1:${this._port}`;
      this._proc = this._spawn("python", ["scrapling-sidecar/app.py", "--port", String(this._port)], { stdio: "ignore" });
      this._proc.on?.("error", () => {});
      for (let i = 0; i < 40; i++) {
        try { const r = await this._fetch(`${this._baseUrl}/health`); if (r.ok) return; } catch {}
        await sleep(500);
      }
      throw new Error("Scrapling sidecar não respondeu — verifique Python ≥3.10 e `pip install scrapling[fetchers]` (ver scrapling-sidecar/README.md).");
    })();
    return this._ready;
  }
  async fetchHtml(url, { timeoutMs = 20000, mode } = {}) {
    await this._ensure();
    const res = await this._fetch(`${this._baseUrl}/fetch`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, mode: mode || this.mode, timeout: timeoutMs }) });
    const data = await res.json();
    if (data.error) throw new Error(`Scrapling: ${data.error}`);
    return { html: data.html, status: data.status ?? 0, finalUrl: data.final_url || url };
  }
  async launchBrowser() { throw new NotSupportedError("Scrapling não fornece browser ao vivo; use Playwright/CloakBrowser para Maps deep-scrape."); }
  async close() { if (this._proc) { try { this._proc.kill(); } catch {} this._proc = null; } }
}
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** `git commit -am "feat(engine): ScraplingEngine sidecar client"`

---

### Task 6: Engine registry + composition root wiring

**Files:**
- Create: `src/infrastructure/engine/registry.js`
- Modify: `src/main.js`
- Test: `test/engine.registry.test.js`

**Interfaces:**
- Produces: `createEngineRegistry() -> { get(name, opts?) -> Engine, closeAll() }`. Lazily instantiates and caches engines by `name` (plus `scrapling:<mode>`). Unknown name falls back to `playwright`.

- [ ] **Step 1: Write the test** — `get("playwright")` returns the playwright engine; `get("scrapling", {mode:"stealth"})` returns a scrapling engine with `mode:"stealth"`; unknown name returns playwright.

```js
import { test } from "node:test"; import assert from "node:assert/strict";
import { createEngineRegistry } from "../src/infrastructure/engine/registry.js";
test("registry resolves engines", () => {
  const reg = createEngineRegistry();
  assert.equal(reg.get("playwright").name, "playwright");
  assert.equal(reg.get("cloakbrowser").name, "cloakbrowser");
  const s = reg.get("scrapling", { mode: "stealth" }); assert.equal(s.name, "scrapling"); assert.equal(s.mode, "stealth");
  assert.equal(reg.get("bogus").name, "playwright");
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement `registry.js`.**

```js
import { PlaywrightEngine } from "./PlaywrightEngine.js";
import { CloakBrowserEngine } from "./CloakBrowserEngine.js";
import { ScraplingEngine } from "./ScraplingEngine.js";

export function createEngineRegistry() {
  const cache = new Map();
  function get(name, opts = {}) {
    if (name === "cloakbrowser") { if (!cache.has("cloakbrowser")) cache.set("cloakbrowser", new CloakBrowserEngine()); return cache.get("cloakbrowser"); }
    if (name === "scrapling") { const mode = opts.mode || "fast"; const key = `scrapling:${mode}`;
      if (!cache.has(key)) cache.set(key, new ScraplingEngine({ mode })); return cache.get(key); }
    if (!cache.has("playwright")) cache.set("playwright", new PlaywrightEngine());
    return cache.get("playwright");
  }
  async function closeAll() { for (const e of cache.values()) await e.close().catch(() => {}); }
  return { get, closeAll };
}
```

- [ ] **Step 4: Wire into `main.js`.** After the imports, add `import { createEngineRegistry } from "./infrastructure/engine/registry.js";` and `const engines = createEngineRegistry();`. Pass `engines` into `createServer({ ..., engines })`. Add a graceful shutdown: `process.on("SIGINT", async () => { await engines.closeAll(); process.exit(0); });`. The scrapers that previously self-launched (GoogleMapsScraper, BrowserEmailScraper) will receive an engine per request (Tasks 7-8, 10) — keep their construction but they will accept an injected engine.

- [ ] **Step 5: Run** `node --test test/engine.registry.test.js` → PASS, and `npm test`.

- [ ] **Step 6: Commit** `git commit -am "feat(engine): registry + composition root wiring"`

---

### Task 7: GoogleMapsScraper consumes injected engine

**Files:**
- Modify: `src/infrastructure/scraper/GoogleMapsScraper.js`
- Test: `test/gmaps.engine.test.js`

**Interfaces:**
- Consumes: `engine.launchBrowser({headless})` (Tasks 1-2).
- Produces: `scrape({ input, maxResults, deep, onProgress, engine })` — same return shape (Lead[]); uses `engine.launchBrowser()` instead of `chromium.launch(...)`.

- [ ] **Step 1: Write the test** — pass a fake engine whose `launchBrowser` returns a stub browser; assert `scrape` calls `engine.launchBrowser` (use a minimal fake that throws a sentinel after launch to avoid full Maps navigation, and assert the sentinel/`launchBrowser` was invoked).

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Modify `GoogleMapsScraper.js`.** Remove `import { chromium } from "playwright";`. In `scrape()` (around line 347) replace `const browser = await chromium.launch(buildLaunchOptions(this.headless));` with `const engine = options.engine; const browser = await engine.launchBrowser({ headless: this.headless });`. Thread `engine` through the `scrape` options. Keep everything else (context, scroll, deep-load) unchanged — the returned `browser` is Playwright-compatible for both Playwright and CloakBrowser engines. If `engine` is missing, default to a `PlaywrightEngine` instance for backward compatibility.

- [ ] **Step 4: Run** → PASS, plus `npm test`.

- [ ] **Step 5: Commit** `git commit -am "refactor(gmaps): use injected engine.launchBrowser"`

---

### Task 8: BrowserEmailScraper consumes injected engine

**Files:**
- Modify: `src/infrastructure/scraper/BrowserEmailScraper.js`
- Test: `test/bemail.engine.test.js`

**Interfaces:**
- Consumes: `engine.launchBrowser({headless})`.
- Produces: `BrowserEmailScraper` whose `#launch()` uses an injected `engine` (ctor `{ headless, engine }`).

- [ ] **Step 1: Write the test** — construct with a fake engine; assert first `scrapeContacts`/`scrapeEmails` triggers `engine.launchBrowser` once (singleton).

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Modify `BrowserEmailScraper.js`.** Replace `import { buildLaunchOptions } from "./GoogleMapsScraper.js";` (now invalid — moved in Task 1) and the `chromium.launch(buildLaunchOptions(...))` call in `#launch()` with `this.engine.launchBrowser({ headless: this.headless })`. Accept `engine` in the constructor; default to a `PlaywrightEngine` if absent.

- [ ] **Step 4: Run** → PASS, plus `npm test`.

- [ ] **Step 5: Commit** `git commit -am "refactor(bemail): use injected engine.launchBrowser"`

---

### Task 9: Fetch-layer scrapers consume injected engine.fetchHtml

**Files:**
- Modify: `src/infrastructure/scraper/EmailScraper.js`
- Modify: `src/infrastructure/scraper/SiteTextScraper.js`
- Modify: `src/infrastructure/scraper/SiteHealthChecker.js`
- Test: `test/fetchlayer.engine.test.js`

**Interfaces:**
- Consumes: `engine.fetchHtml(url, {timeoutMs, headers})`.
- Produces: each scraper accepts an optional `engine` (ctor or per-call). When present, its internal `#get`/fetch routes through `engine.fetchHtml`; when absent, behavior is identical to today (native fetch).

- [ ] **Step 1: Write the test** — inject a `FakeEngine` with canned HTML into `EmailScraper`; assert `scrapeContacts` extracts emails from the engine-provided HTML and that `engine.fetchHtml` received the right URL.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Modify the three scrapers.** Add `engine` to each constructor. In `EmailScraper.#get(url)` (line 111): if `this.engine`, replace the `fetch(...)` body with `const { html, status } = await this.engine.fetchHtml(url, { timeoutMs: this.timeoutMs, headers: {...} }); if (status && (status === 429 || status >= 500)) { const e=new Error(\`HTTP ${status}\`); e.transient=true; throw e; } return html;` keeping the existing error-classification semantics. Apply the analogous change to `SiteTextScraper` (its `fetchText` fetch) and `SiteHealthChecker.check` (route the request through `engine.fetchHtml`, mapping non-200 status to the existing `{down, reason}` logic). Keep the native-fetch path as the default when `engine` is undefined.

- [ ] **Step 4: Run** → PASS, plus `npm test`.

- [ ] **Step 5: Commit** `git commit -am "refactor(fetch-layer): route Email/SiteText/Health through engine.fetchHtml"`

---

### Task 10: Server resolves engine per request and injects it

**Files:**
- Modify: `src/infrastructure/http/server.js`
- Test: `test/server.engine.test.js`

**Interfaces:**
- Consumes: `engines.get(name, {mode})` (Task 6).
- Produces: `/api/scrape`, `/api/emails`, `/api/sitetext`, `/api/socials` read `engine` (and `scraplingMode`) query params, resolve via `engines`, and pass the engine into the relevant scraper/use-case. `createServer` now accepts `engines` in its deps object.

- [ ] **Step 1: Write the test** — start the server with a stub `engines.get` that records the requested name; hit `/api/scrape?engine=cloakbrowser&...`; assert `engines.get` was called with `"cloakbrowser"`. (Use a fake scraper that returns `[]` immediately to keep it fast.)

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Modify `server.js`.** Destructure `engines` from `createServer` deps. Add a helper `function resolveEngine(req){ const name = req.query.engine || "playwright"; return engines.get(name, { mode: req.query.scraplingMode || "fast" }); }`. In `/api/scrape`: `const engine = resolveEngine(req);` and, when not grid/city, call `scraper.scrape({ input, maxResults, deep, onProgress, engine })`. **Scrapling guard:** if `engine.supportsBrowser === false` and the mode needs the live browser (normal deep scrape), automatically route to the grid `pb=` path and emit an SSE progress note ("Scrapling não abre browser ao vivo — usando endpoint pb= com stealth"). In `/api/emails`, `/api/sitetext`, `/api/socials`: resolve the engine and pass it into the use-case so the underlying scrapers use `engine.fetchHtml` / `engine.launchBrowser` (for the browser fallback, only when `supportsBrowser`).

- [ ] **Step 4: Run** → PASS, plus `npm test`.

- [ ] **Step 5: Commit** `git commit -am "feat(server): resolve+inject engine per request"`

---

### Task 11: UI engine selector

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css` (if needed for the new controls)

**Interfaces:**
- Consumes: server query params `engine`, `scraplingMode`.
- Produces: a `<select id="engine">` and a conditionally-shown `<select id="scraplingMode">`; their values are appended to `/api/scrape` and to the enrichment job URLs.

- [ ] **Step 1: Add controls to `index.html`** near the mode select:

```html
<label>Engine
  <select id="engine">
    <option value="playwright">Playwright (padrão)</option>
    <option value="cloakbrowser">CloakBrowser (anti-ban)</option>
    <option value="scrapling">Scrapling (rápido/stealth)</option>
  </select>
</label>
<label id="scraplingModeWrap" style="display:none">Modo Scrapling
  <select id="scraplingMode">
    <option value="fast">fast (HTTP/TLS)</option>
    <option value="dynamic">dynamic (browser)</option>
    <option value="stealth">stealth (Camoufox)</option>
  </select>
</label>
```

- [ ] **Step 2: Wire visibility + params in `app.js`.** Add a listener: when `#engine` value is `scrapling`, show `#scraplingModeWrap`, else hide. In `start()` (line ~287) append to the scrape params: `params.set("engine", $("engine").value); if ($("engine").value === "scrapling") params.set("scraplingMode", $("scraplingMode").value);`. In `runJob(url, ...)` (line ~371) and the enrichment callers (`emailScrape`, `sitetext`, `socialScrape`), append the same `engine`/`scraplingMode` query args so enrichment uses the chosen engine.

- [ ] **Step 3: Manual verification** (documented): `npm start`, open the UI, pick CloakBrowser, run a small scrape, confirm in server logs the engine resolved is `cloakbrowser`. Pick Scrapling → the mode select appears.

- [ ] **Step 4: Commit** `git commit -am "feat(ui): engine selector + scrapling mode"`

---

### Task 12: Docs + dependency notes

**Files:**
- Modify: `README.md`
- Modify: `package.json` (already has cloak deps from Task 3)

- [ ] **Step 1: Document** in `README.md`: the three engines, when to use each (Playwright default, CloakBrowser for anti-ban/Cloudflare, Scrapling fast/stealth for high-volume fetch); CloakBrowser binary (~200MB auto-download, free binary license, no redistribution); Scrapling sidecar setup (Python ≥3.10, `pip install -r scrapling-sidecar/requirements.txt`, `scrapling install`); and the Scrapling-on-Maps limitation (falls back to `pb=` fetch path).

- [ ] **Step 2: Commit** `git commit -am "docs: engines usage + setup"`

---

## Self-Review Notes

- Spec §3.3 (Engine interface) → Tasks 1-5. §3.4 (sidecar) → Task 4. §3.5 (consumer refactor) → Tasks 7-9. §3.6 (UI/server wiring) → Tasks 10-11. §3.7 (deps) → Tasks 3,12. All covered.
- Type consistency: `fetchHtml -> {html,status,finalUrl}` and `launchBrowser -> Browser` used identically across PlaywrightEngine, CloakBrowserEngine, ScraplingEngine, FakeEngine, and all consumers.
- Backward compatibility: every refactored scraper defaults to Playwright/native-fetch when no engine injected, so default behavior is unchanged (Global Constraints).
- Known follow-up (not in this plan): Scrapling driving the interactive Maps scroll (Approach A) — deferred per spec §5.
