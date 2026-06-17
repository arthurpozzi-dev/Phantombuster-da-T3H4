/**
 * Scraper de e-mails com NAVEGADOR real (Playwright/Chromium) — fallback para
 * sites 100% renderizados por JavaScript, onde o `fetch` (EmailScraper) lê só o
 * HTML inicial e não enxerga o e-mail.
 *
 * É caro (um navegador é ~10–30× mais lento que fetch), então o uso correto é
 * CONDICIONAL: roda só nos leads que ficaram sem e-mail no passo rápido.
 *
 * Estratégia: renderiza a home, extrai e-mails do DOM já renderizado e segue
 * até `maxPages` links internos de contato (reaproveitando a mesma extração e a
 * mesma descoberta de links do EmailScraper). Bloqueia imagens/fontes/mídia
 * para acelerar.
 *
 * Ciclo de vida: o navegador sobe sob demanda (na 1ª chamada) e deve ser
 * fechado com `close()` ao fim do lote. Uma instância por requisição evita que
 * o fechamento de uma derrube outra.
 */
import { PlaywrightEngine } from "../engine/PlaywrightEngine.js";
import { extractEmails, extractSocials } from "./SiteTextScraper.js";
import { findContactLinks } from "./EmailScraper.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const normalizeUrl = (url) => (/^https?:\/\//i.test(url) ? url : `https://${url}`);

export class BrowserEmailScraper {
  /**
   * @param {Object} [options]
   * @param {boolean} [options.headless=true]
   * @param {number} [options.timeoutMs=25000] tempo máximo de navegação por página
   * @param {number} [options.settleMs=1800]   espera após o load, para o JS renderizar
   * @param {number} [options.maxPages=3]       máx. de páginas de contato além da home
   */
  constructor({ headless = true, timeoutMs = 25000, settleMs = 1800, maxPages = 3, engine } = {}) {
    this.headless = headless;
    this.timeoutMs = timeoutMs;
    this.settleMs = settleMs;
    this.maxPages = maxPages;
    this.engine = engine || new PlaywrightEngine();
    this.browser = null;
    this.launching = null;
  }

  /** Sobe o navegador uma única vez via engine (seguro sob concorrência). */
  async #launch() {
    if (this.browser) return this.browser;
    if (!this.launching) this.launching = this.engine.launchBrowser({ headless: this.headless });
    this.browser = await this.launching;
    return this.browser;
  }

  /** @internal gancho para teste do singleton de launch. */
  async _launchForTest() {
    return this.#launch();
  }

  /** Fecha o navegador, se estiver aberto. Idempotente. */
  async close() {
    const b = this.browser;
    this.browser = null;
    this.launching = null;
    if (b) await b.close().catch(() => {});
  }

  /** Renderiza uma URL e devolve o HTML final (DOM já com o JS executado). */
  async #renderHtml(context, url) {
    const page = await context.newPage();
    await page.route("**/*", (route) => {
      const t = route.request().resourceType();
      return t === "image" || t === "media" || t === "font" ? route.abort() : route.continue();
    });
    try {
      await page
        .goto(normalizeUrl(url), { waitUntil: "domcontentloaded", timeout: this.timeoutMs })
        .catch(() => {}); // mesmo em timeout parcial, lemos o que já renderizou
      await page.waitForTimeout(this.settleMs);
      return await page.content();
    } finally {
      await page.close().catch(() => {});
    }
  }

  /**
   * Scraping de CONTATOS (e-mails + redes sociais) de um site, renderizando-o num
   * navegador real — para sites 100% JavaScript.
   * @param {string} url
   * @returns {Promise<{ emails: string[], socials: string[], pagesVisited: number }>}
   */
  async scrapeContacts(url) {
    await this.#launch();
    const context = await this.browser.newContext({
      locale: "pt-BR",
      userAgent: UA,
      viewport: { width: 1280, height: 900 },
    });
    try {
      const home = await this.#renderHtml(context, url);
      const emails = new Set(extractEmails(home));
      const socials = new Set(extractSocials(home));
      let pagesVisited = 1;

      const candidates = findContactLinks(home, url).slice(0, this.maxPages);
      for (const link of candidates) {
        try {
          const html = await this.#renderHtml(context, link);
          pagesVisited++;
          for (const e of extractEmails(html)) emails.add(e);
          for (const s of extractSocials(html)) socials.add(s);
        } catch {
          /* página de contato que falha não derruba o lead */
        }
      }
      return { emails: [...emails], socials: [...socials], pagesVisited };
    } finally {
      await context.close().catch(() => {});
    }
  }

  /**
   * Atalho para quem quer só os e-mails (mantém a assinatura antiga).
   * @param {string} url
   * @returns {Promise<{ emails: string[], pagesVisited: number }>}
   */
  async scrapeEmails(url) {
    const { emails, pagesVisited } = await this.scrapeContacts(url);
    return { emails, pagesVisited };
  }
}
