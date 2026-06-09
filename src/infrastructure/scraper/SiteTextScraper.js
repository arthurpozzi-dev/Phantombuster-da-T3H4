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

export class SiteTextScraper {
  /**
   * @param {Object} [options]
   * @param {number} [options.timeoutMs=15000]
   */
  constructor({ timeoutMs = 15000 } = {}) {
    this.timeoutMs = timeoutMs;
  }

  /**
   * Baixa e extrai o texto visível de uma URL.
   * @param {string} url
   * @returns {Promise<{ text: string }>}
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
      return { text: htmlToText(html) };
    } catch (e) {
      if (e.name === "AbortError") throw new Error(`Tempo esgotado (>${Math.round(this.timeoutMs / 1000)}s)`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}
