/**
 * Verificador de "o site está no ar?".
 *
 * O PageSpeed mede a performance de QUALQUER página que carregue — inclusive de
 * uma página de erro "404", que (por ser pequena) ainda recebe nota boa. Isso
 * engana o enriquecimento. Aqui fazemos uma checagem própria, olhando:
 *   - o status HTTP (404/410/5xx = fora do ar);
 *   - falhas de conexão/DNS (domínio morto);
 *   - "soft 404": status 200, mas a página é claramente de erro/expirada
 *     (ex.: título "Página não encontrada", "Domínio à venda", "Site suspenso").
 *
 * É conservador de propósito: 401/403/429 e timeout NÃO marcam como fora do ar
 * (costumam ser bloqueio anti-bot ou lentidão, com o site no ar de verdade).
 */

/** Marcadores fortes de página de erro/parqueada (PT e EN). */
const ERROR_MARKERS = [
  "erro 404",
  "error 404",
  "404 not found",
  "404 - not found",
  "página não encontrada",
  "pagina nao encontrada",
  "page not found",
  "site não encontrado",
  "este site não pode ser acessado",
  "domínio à venda",
  "dominio a venda",
  "this domain is for sale",
  "buy this domain",
  "domínio expirado",
  "domain has expired",
  "conta suspensa",
  "account suspended",
  "site suspenso",
];

/** Códigos de erro de rede que indicam domínio/host inacessível. */
const DEAD_NET_CODES = ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "CERT_HAS_EXPIRED"];

/** Texto visível aproximado (sem tags/scripts), só para medir tamanho. */
function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Detecta uma página de erro a partir do HTML (status 200).
 * Marca como erro se um marcador aparece no <title>, OU no corpo de uma página
 * curta (páginas de erro costumam ter pouco conteúdo).
 * @param {string} html
 * @returns {string|null} o marcador encontrado, ou null.
 */
export function detectErrorPage(html) {
  if (!html) return null;
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").toLowerCase();
  const inTitle = ERROR_MARKERS.find((m) => title.includes(m));
  if (inTitle) return inTitle;

  const text = visibleText(html).toLowerCase();
  if (text.length < 1500) {
    const inBody = ERROR_MARKERS.find((m) => text.includes(m));
    if (inBody) return inBody;
  }
  return null;
}

export class SiteHealthChecker {
  /**
   * @param {Object} [options]
   * @param {number} [options.timeoutMs=12000]
   */
  constructor({ timeoutMs = 12000 } = {}) {
    this.timeoutMs = timeoutMs;
  }

  /**
   * @param {string} url
   * @returns {Promise<{ down: boolean, reason?: string }>}
   */
  async check(url) {
    const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(target, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
      });

      const s = res.status;
      if (s === 404 || s === 410 || s >= 500) return { down: true, reason: `HTTP ${s}` };

      // Soft 404: respondeu OK, mas o conteúdo é uma página de erro/parqueada.
      if (s >= 200 && s < 300) {
        const html = await res.text().catch(() => "");
        const marker = detectErrorPage(html);
        if (marker) return { down: true, reason: `Página de erro: "${marker}"` };
      }
      return { down: false };
    } catch (e) {
      if (e.name === "AbortError") return { down: false, reason: "timeout (não conclusivo)" };
      const code = e?.cause?.code || "";
      if (DEAD_NET_CODES.includes(code) || /ENOTFOUND|ECONNREFUSED|getaddrinfo/i.test(e.message || ""))
        return { down: true, reason: code || "conexão falhou" };
      return { down: false, reason: e.message };
    } finally {
      clearTimeout(timer);
    }
  }
}
