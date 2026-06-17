/**
 * Engine anti-ban: CloakBrowser (Chromium stealth com 58 patches no nível do C++).
 *
 * Drop-in do Playwright em Node: `launch()` devolve um Browser padrão do
 * Playwright. Passa Cloudflare Turnstile/FingerprintJS, navigator.webdriver=false.
 * O binário (~200MB) é baixado automaticamente em ~/.cloakbrowser/ no 1º uso.
 *
 *  - launchBrowser: cloakbrowser.launch (Browser ao vivo).
 *  - fetchHtml: navega numa página stealth reutilizada e devolve o HTML.
 *
 * O import de "cloakbrowser" é LAZY — só acontece quando este engine é usado,
 * evitando o custo/download quando o usuário fica no Playwright.
 *
 * O binário do CloakBrowser fica em ~/.cloakbrowser/ e precisa das mesmas libs
 * de sistema do Chromium (libnss3, libnspr4, libasound2…). Em ambientes sem essas
 * libs instaladas via apt, reaproveitamos a pasta `.chromium-libs/` do projeto
 * (mesmo mecanismo do Playwright) pondo-a no LD_LIBRARY_PATH do processo — o
 * Chromium filho herda. Sem a pasta, é no-op.
 */
import { browserEnv } from "./launchOptions.js";

const CLOAK_ARGS = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"];

export class CloakBrowserEngine {
  /** @param {{ launchImpl?: (opts:any)=>Promise<any> }} [options] */
  constructor({ launchImpl } = {}) {
    this.name = "cloakbrowser";
    this.supportsBrowser = true;
    this._launch = launchImpl || null;
    this._fetchBrowser = null;
  }

  async _resolveLaunch() {
    if (this._launch) return this._launch;
    const mod = await import("cloakbrowser"); // lazy: só quando este engine é usado
    this._launch = mod.launch;
    return this._launch;
  }

  /** Opções de launch: args stealth + libs locais (se houver). Também garante o
   * LD_LIBRARY_PATH no processo, pois o cloak pode não repassar `env`. */
  _launchOpts(headless) {
    const env = browserEnv();
    if (env?.LD_LIBRARY_PATH) process.env.LD_LIBRARY_PATH = env.LD_LIBRARY_PATH;
    return { headless, args: CLOAK_ARGS, ...(env ? { env } : {}) };
  }

  async launchBrowser({ headless = true } = {}) {
    const launch = await this._resolveLaunch();
    return launch(this._launchOpts(headless));
  }

  async fetchHtml(url, { timeoutMs = 25000 } = {}) {
    const launch = await this._resolveLaunch();
    if (!this._fetchBrowser) this._fetchBrowser = await launch(this._launchOpts(true));
    const page = await this._fetchBrowser.newPage();
    try {
      const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      return { html: await page.content(), status: resp?.status?.() ?? 200, finalUrl: page.url() };
    } finally {
      await page.close().catch(() => {});
    }
  }

  async close() {
    if (this._fetchBrowser) {
      await this._fetchBrowser.close().catch(() => {});
      this._fetchBrowser = null;
    }
  }
}
