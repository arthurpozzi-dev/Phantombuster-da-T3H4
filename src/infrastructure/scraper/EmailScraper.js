/**
 * Scraper DEDICADO de e-mails de um estabelecimento.
 *
 * Diferente do SiteTextScraper (que extrai e-mails só da home, como efeito
 * colateral de puxar o texto), aqui o objetivo é um scraping COMPLETO de
 * contatos:
 *   1) baixa a página inicial e extrai os e-mails dela;
 *   2) descobre links internos "de contato" (contato, fale-conosco, sobre,
 *      equipe, atendimento…) dentro do MESMO domínio;
 *   3) visita até `maxPages` dessas páginas e agrega os e-mails encontrados.
 *
 * Reaproveita a extração/desofuscação de e-mails do SiteTextScraper. Leve e
 * rápido — usa fetch nativo, sem browser.
 */
import { extractEmails } from "./SiteTextScraper.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Pistas de URL para páginas que costumam conter o e-mail (PT e EN). */
const CONTACT_HINTS = [
  "contato", "contatos", "contact", "fale-conosco", "fale_conosco", "faleconosco",
  "fale-com", "sobre", "about", "quem-somos", "quemsomos", "equipe", "team",
  "atendimento", "suporte", "support", "ajuda", "help", "institucional",
];

/** Caminhos onde o e-mail costuma estar — sondados mesmo se não houver link. */
const COMMON_PATHS = [
  "/contato", "/contato.php", "/contato.html", "/fale-conosco", "/contact",
  "/contact-us", "/sobre", "/about", "/quem-somos",
];

const normalizeUrl = (url) => (/^https?:\/\//i.test(url) ? url : `https://${url}`);
const bareHost = (h) => h.replace(/^www\./, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Variantes de URL a tentar para a home, em ordem: como veio, alternando
 * www↔apex e, por último, http (alguns sites antigos só respondem em http).
 * Reduz "falsas falhas" de DNS/SSL/redirecionamento.
 * @param {string} url
 * @returns {string[]}
 */
export function urlVariants(url) {
  const base = normalizeUrl(url);
  const out = [base];
  try {
    const toggled = new URL(base);
    toggled.hostname = toggled.hostname.startsWith("www.")
      ? toggled.hostname.slice(4)
      : "www." + toggled.hostname;
    out.push(toggled.toString());
    const http = new URL(base);
    http.protocol = "http:";
    out.push(http.toString());
  } catch {
    /* URL inválida: fica só com a base */
  }
  return [...new Set(out)];
}

/**
 * Extrai os links internos candidatos (páginas de contato/sobre) do HTML da home.
 * Só considera links do MESMO domínio e que casem com as pistas conhecidas.
 * @param {string} html
 * @param {string} baseUrl
 * @returns {string[]} URLs absolutas, sem repetição.
 */
export function findContactLinks(html, baseUrl) {
  if (!html) return [];
  const links = new Set();
  let base;
  try {
    base = new URL(normalizeUrl(baseUrl));
  } catch {
    return [];
  }
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
    const href = m[1].trim();
    if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
    let abs;
    try {
      abs = new URL(href, base);
    } catch {
      continue;
    }
    if (bareHost(abs.hostname) !== bareHost(base.hostname)) continue; // só o próprio site
    const path = (abs.pathname + abs.search).toLowerCase();
    if (CONTACT_HINTS.some((h) => path.includes(h))) {
      abs.hash = "";
      links.add(abs.toString());
    }
  }
  return [...links];
}

export class EmailScraper {
  /**
   * @param {Object} [options]
   * @param {number} [options.timeoutMs=15000] tempo máximo por requisição
   * @param {number} [options.maxPages=6]       máx. de páginas internas visitadas além da home
   * @param {number} [options.retries=1]        re-tentativas em falhas transitórias (timeout/rede/5xx/429)
   */
  constructor({ timeoutMs = 15000, maxPages = 6, retries = 1 } = {}) {
    this.timeoutMs = timeoutMs;
    this.maxPages = maxPages;
    this.retries = retries;
  }

  /** Uma requisição GET de HTML (ou lança um erro legível e classificável). */
  async #get(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        },
      });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`);
        err.transient = res.status === 429 || res.status >= 500; // vale re-tentar
        throw err;
      }
      const type = res.headers.get("content-type") || "";
      if (!/text\/html|xml/i.test(type)) throw new Error(`Conteúdo não-HTML (${type || "?"})`);
      return await res.text();
    } catch (e) {
      if (e.name === "AbortError") {
        const err = new Error(`Tempo esgotado (>${Math.round(this.timeoutMs / 1000)}s)`);
        err.transient = true;
        throw err;
      }
      if (e.transient === undefined) e.transient = true; // erros de rede/DNS/SSL
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /** GET com re-tentativa em falhas transitórias (backoff curto). */
  async #getWithRetry(url) {
    let lastErr;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        return await this.#get(url);
      } catch (e) {
        lastErr = e;
        if (!e.transient || attempt === this.retries) break;
        await sleep(400 * (attempt + 1));
      }
    }
    throw lastErr;
  }

  /**
   * Baixa a home tentando as variantes de URL (www/apex/http) em ordem.
   * @returns {Promise<{ html: string, finalUrl: string }>}
   * @throws o último erro se NENHUMA variante responder.
   */
  async #fetchHome(url) {
    let lastErr;
    for (const variant of urlVariants(url)) {
      try {
        return { html: await this.#getWithRetry(variant), finalUrl: variant };
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("falha ao carregar o site");
  }

  /**
   * Faz o scraping completo de e-mails de um site: home + páginas de contato
   * (descobertas por link e sondadas em caminhos comuns).
   * @param {string} url
   * @returns {Promise<{ emails: string[], pagesVisited: number }>}
   * @throws se nem a página inicial puder ser carregada.
   */
  async scrapeEmails(url) {
    const { html: home, finalUrl } = await this.#fetchHome(url); // se falhar, o lead vira "erro"
    const emails = new Set(extractEmails(home));
    let pagesVisited = 1;

    // Links de contato descobertos no HTML (prioridade) + caminhos comuns sondados.
    const discovered = findContactLinks(home, finalUrl);
    const probed = COMMON_PATHS.map((p) => {
      try {
        return new URL(p, finalUrl).toString();
      } catch {
        return null;
      }
    }).filter(Boolean);
    const candidates = [...new Set([...discovered, ...probed])]
      .filter((u) => u !== finalUrl)
      .slice(0, this.maxPages);

    for (const link of candidates) {
      try {
        const page = await this.#get(link); // caminho comum pode ser 404: tudo bem
        pagesVisited++;
        for (const e of extractEmails(page)) emails.add(e);
      } catch {
        /* uma página de contato que falha não derruba o lead */
      }
    }

    return { emails: [...emails], pagesVisited };
  }
}
