/**
 * Scraper de TEXTO dos sites.
 *
 * Baixa o HTML do site (via fetch nativo), remove scripts/estilos/tags e
 * devolve o texto visível condensado (espaços colapsados), pronto para caber em
 * uma única célula de planilha. Leve e rápido — não usa browser.
 *
 * Limitação: sites 100% renderizados por JavaScript podem devolver pouco texto,
 * pois aqui lemos o HTML inicial, sem executar scripts.
 */

/** Limite de caracteres por célula no Excel é 32.767; deixamos margem. */
const MAX_CHARS = 32000;

const DECODE = {
  "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
  "&#39;": "'", "&apos;": "'", "&hellip;": "…", "&mdash;": "—", "&ndash;": "–",
};

/** Decodifica as entidades HTML mais comuns + numéricas. */
function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => {
      try {
        return String.fromCodePoint(parseInt(n, 10));
      } catch {
        return "";
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      try {
        return String.fromCodePoint(parseInt(n, 16));
      } catch {
        return "";
      }
    })
    .replace(/&[a-z]+;/gi, (m) => DECODE[m.toLowerCase()] ?? " ");
}

/** Extrai o texto visível de um HTML. */
export function htmlToText(html) {
  if (!html) return "";
  let t = html;
  // Remove blocos não-visíveis inteiros.
  t = t.replace(/<script[\s\S]*?<\/script>/gi, " ");
  t = t.replace(/<style[\s\S]*?<\/style>/gi, " ");
  t = t.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  t = t.replace(/<!--[\s\S]*?-->/g, " ");
  t = t.replace(/<head[\s\S]*?<\/head>/gi, " ");
  // Quebras lógicas viram espaço.
  t = t.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*>/gi, " ");
  // Remove o resto das tags.
  t = t.replace(/<[^>]+>/g, " ");
  t = decodeEntities(t);
  // Colapsa espaços/quebras.
  t = t.replace(/\s+/g, " ").trim();
  return t.length > MAX_CHARS ? t.slice(0, MAX_CHARS) + " […]" : t;
}

/** Extensões de arquivo que viram "falso e-mail" (ex.: logo@2x.png). */
const ASSET_TLDS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico",
  "css", "js", "mp4", "webm", "woff", "woff2", "ttf", "eot", "pdf",
]);

const EMAIL_RE = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi;

/**
 * Domínios de placeholder/exemplo: aparecem em templates e textos de demonstração,
 * nunca são o contato real do estabelecimento.
 */
const PLACEHOLDER_DOMAINS = new Set([
  "example.com", "example.org", "example.net", "example.edu",
  "domain.com", "yourdomain.com", "seudominio.com", "seudominio.com.br",
  "yoursite.com", "seusite.com", "seusite.com.br", "email.com",
  "mydomain.com", "meudominio.com", "site.com", "test.com", "teste.com",
]);

/**
 * Domínios de construtores de site / provedores de plataforma. Um e-mail nesses
 * domínios é da plataforma, não do estabelecimento — não dá para contatar o lead.
 */
const PLATFORM_DOMAINS = new Set([
  "wix.com", "squarespace.com", "godaddy.com", "weebly.com",
  "shopify.com", "webnode.com", "jimdo.com", "wordpress.com",
]);

/** Endereços de "não responda" (válidos, mas não servem para contatar o lead). */
const NOREPLY_RE = /^(no[._-]?reply|donotreply|do[._-]?not[._-]?reply|nao[._-]?respond)/;

/** Verdadeiro se o domínio é, ou é subdomínio de, algum domínio do conjunto. */
function domainInSet(domain, set) {
  if (set.has(domain)) return true;
  for (const d of set) if (domain.endsWith("." + d)) return true;
  return false;
}

/**
 * Detecta e-mails que NÃO servem como contato comercial do lead:
 *   - placeholders de template (example.com, seudominio.com.br…);
 *   - telemetria/infra embutida no HTML (Sentry, Wix/wixpress) ou "local part"
 *     que é só um hash de máquina (ex.: c183baa2…@sentry.wixpress.com);
 *   - domínios de construtores de site/plataforma (@wix.com, @squarespace.com…);
 *   - endereços "no-reply" (não dá para responder/contatar por eles).
 * @param {string} email
 * @returns {boolean}
 */
export function isJunkEmail(email) {
  const [local = "", domain = ""] = (email || "").toLowerCase().split("@");
  if (domainInSet(domain, PLACEHOLDER_DOMAINS)) return true;
  if (domainInSet(domain, PLATFORM_DOMAINS)) return true;
  // Telemetria/monitoramento embutido no site (não é contato):
  if (domain.includes("sentry") || domain.endsWith("wixpress.com")) return true;
  // "Local part" é um hash/ID gerado por máquina (ex.: erros do Sentry):
  if (/^[0-9a-f]{16,}$/.test(local)) return true;
  // "Não responda": e-mail real, mas não serve para contatar o lead.
  if (NOREPLY_RE.test(local)) return true;
  return false;
}

/** Valida e filtra falsos positivos (assets, domínios inválidos, lixo/telemetria). */
function isRealEmail(e) {
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e)) return false;
  if (e.includes("..")) return false;
  const tld = e.split(".").pop().toLowerCase();
  if (ASSET_TLDS.has(tld)) return false;
  return !isJunkEmail(e);
}

/**
 * Decodifica e-mails ofuscados pelo Cloudflare "Email Protection" — muito comum.
 * Aparecem como `data-cfemail="HEX"` ou em links `/cdn-cgi/l/email-protection#HEX`,
 * onde o primeiro byte é a chave XOR aplicada aos demais.
 * @param {string} html
 * @returns {string[]}
 */
export function decodeCloudflareEmails(html) {
  const out = [];
  const decode = (hex) => {
    try {
      const key = parseInt(hex.slice(0, 2), 16);
      let email = "";
      for (let i = 2; i < hex.length; i += 2)
        email += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
      out.push(email);
    } catch {
      /* hex inválido: ignora */
    }
  };
  for (const m of html.matchAll(/data-cfemail=["']([0-9a-fA-F]+)["']/g)) decode(m[1]);
  for (const m of html.matchAll(/\/cdn-cgi\/l\/email-protection#([0-9a-fA-F]+)/g)) decode(m[1]);
  return out;
}

/**
 * Extrai TODOS os e-mails de um HTML: de links `mailto:`, de botões e do texto.
 * Lida com ofuscações comuns (&#64;, [at], [dot]). Devolve em minúsculas, sem
 * repetição.
 * @param {string} html
 * @returns {string[]}
 */
export function extractEmails(html) {
  if (!html) return [];
  const found = new Set();

  // 1) Links mailto: (inclui botões <a class="btn" href="mailto:...">).
  for (const m of html.matchAll(/mailto:([^"'?\s>]+)/gi)) {
    const e = decodeURIComponent(m[1]).trim().toLowerCase();
    if (isRealEmail(e)) found.add(e);
  }

  // 2) Qualquer e-mail no HTML/texto, desofuscando padrões comuns.
  const desofuscado = html
    .replace(/&#0*64;|&#x0*40;/gi, "@")
    .replace(/\s*[\[(]\s*at\s*[\])]\s*/gi, "@")
    .replace(/\s*[\[(]\s*dot\s*[\])]\s*/gi, ".");
  for (const m of desofuscado.matchAll(EMAIL_RE)) {
    const e = m[0].trim().toLowerCase();
    if (isRealEmail(e)) found.add(e);
  }

  // 3) E-mails protegidos pelo Cloudflare (data-cfemail / email-protection#hex).
  for (const e of decodeCloudflareEmails(html)) {
    const x = e.trim().toLowerCase();
    if (isRealEmail(x)) found.add(x);
  }

  return [...found].slice(0, 30);
}

export class SiteTextScraper {
  /**
   * @param {Object} [options]
   * @param {number} [options.timeoutMs=15000]
   */
  constructor({ timeoutMs = 15000 } = {}) {
    this.timeoutMs = timeoutMs;
  }

  /**
   * Baixa o site e extrai o texto visível + os e-mails encontrados.
   * @param {string} url
   * @returns {Promise<{ text: string, emails: string[] }>}
   * @throws se a requisição falhar ou não for HTML.
   */
  async fetchText(url) {
    const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(target, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const type = res.headers.get("content-type") || "";
      if (!/text\/html|xml/i.test(type)) throw new Error(`Conteúdo não-HTML (${type || "?"})`);
      const html = await res.text();
      return { text: htmlToText(html), emails: extractEmails(html) };
    } catch (e) {
      if (e.name === "AbortError") throw new Error(`Tempo esgotado (>${Math.round(this.timeoutMs / 1000)}s)`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}
