/**
 * Cliente da PageSpeed Insights API v5 (Google).
 *
 * Mede a performance de um site e devolve um RELATÓRIO detalhado:
 *  - pontuações das 4 categorias do Lighthouse (performance, acessibilidade,
 *    boas práticas, SEO);
 *  - métricas de laboratório (LCP, FCP, CLS, TBT, Speed Index, TTI);
 *  - dados de campo reais (CrUX), quando o site tiver volume suficiente;
 *  - principais oportunidades de melhoria.
 *
 * Doc: https://developers.google.com/speed/docs/insights/v5/get-started
 *
 * A chave de API vem por injeção (do servidor), com fallback para a env
 * PAGESPEED_API_KEY. Não há chave hardcoded neste arquivo.
 */

const ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
/** Todas as categorias do Lighthouse (usadas no modo "análise profunda"/relatório). */
export const ALL_CATEGORIES = ["performance", "accessibility", "best-practices", "seo"];

/** Garante que a URL tenha protocolo (a API exige URL absoluta). */
function normalizeUrl(url) {
  const u = (url || "").trim();
  if (!u) return "";
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (s) => (typeof s === "number" ? Math.round(s * 100) : null);

/** Extrai uma métrica de laboratório dos audits do Lighthouse. */
function labMetric(audits, id) {
  const a = audits?.[id];
  if (!a) return null;
  return { display: a.displayValue || "", value: a.numericValue ?? null, score: pct(a.score) };
}

/** Extrai uma métrica de campo (CrUX) de loadingExperience.metrics. */
function fieldMetric(metrics, key) {
  const m = metrics?.[key];
  if (!m) return null;
  return { percentile: m.percentile ?? null, category: m.category || null };
}

/** Monta o relatório completo a partir da resposta crua da API. */
function buildReport(data) {
  // Aceita o envelope do PageSpeed v5 ({ lighthouseResult }) OU o lhr cru no topo
  // (instâncias self-hosted que devolvem o Lighthouse Result direto).
  const lh = data.lighthouseResult || data || {};
  const cat = lh.categories || {};
  const audits = lh.audits || {};
  const le = data.loadingExperience || {};
  const fieldMetrics = le.metrics || {};

  const categories = {
    performance: pct(cat.performance?.score),
    accessibility: pct(cat.accessibility?.score),
    bestPractices: pct(cat["best-practices"]?.score),
    seo: pct(cat.seo?.score),
  };

  const metrics = {
    lcp: labMetric(audits, "largest-contentful-paint"),
    fcp: labMetric(audits, "first-contentful-paint"),
    cls: labMetric(audits, "cumulative-layout-shift"),
    tbt: labMetric(audits, "total-blocking-time"),
    si: labMetric(audits, "speed-index"),
    tti: labMetric(audits, "interactive"),
  };

  // Dados de campo (usuários reais). null quando o site não tem amostra no CrUX.
  const hasField = Object.keys(fieldMetrics).length > 0;
  const field = hasField
    ? {
        overall: le.overall_category || null,
        lcp: fieldMetric(fieldMetrics, "LARGEST_CONTENTFUL_PAINT_MS"),
        inp: fieldMetric(fieldMetrics, "INTERACTION_TO_NEXT_PAINT"),
        cls: fieldMetric(fieldMetrics, "CUMULATIVE_LAYOUT_SHIFT_SCORE"),
        fcp: fieldMetric(fieldMetrics, "FIRST_CONTENTFUL_PAINT_MS"),
        ttfb: fieldMetric(fieldMetrics, "EXPERIMENTAL_TIME_TO_FIRST_BYTE"),
      }
    : null;

  // Oportunidades de melhoria (maiores ganhos estimados primeiro).
  const opportunities = Object.values(audits)
    .filter((a) => a?.details?.type === "opportunity" && (a.numericValue || 0) > 0)
    .sort((a, b) => (b.numericValue || 0) - (a.numericValue || 0))
    .slice(0, 8)
    .map((a) => ({
      title: a.title,
      display: a.displayValue || "",
      savingsMs: Math.round(a.numericValue || 0),
    }));

  return {
    score: categories.performance,
    categories,
    metrics,
    field,
    opportunities,
    fetchedAt: lh.fetchTime || new Date().toISOString(),
  };
}

export class PageSpeedClient {
  /**
   * @param {Object} [options]
   * @param {string} [options.apiKey]   chave da API (sobrepõe a env)
   * @param {string} [options.baseUrl]  URL base da instância self-hosted (substitui o endpoint do Google)
   * @param {"mobile"|"desktop"} [options.strategy="mobile"]
   * @param {number} [options.timeoutMs=45000]   timeout por tentativa
   * @param {number} [options.maxRetries=1]       tentativas extras em falha transitória
   * @param {string[]} [options.categories=["performance"]]  categorias do Lighthouse a pedir
   * @param {typeof fetch} [options.fetchImpl]   injeção para testes
   */
  constructor({ apiKey, baseUrl, strategy = "mobile", timeoutMs = 45000, maxRetries = 1, categories = ["performance"], fetchImpl } = {}) {
    this.apiKey = apiKey || process.env.PAGESPEED_API_KEY || "";
    this.baseUrl = baseUrl || "";
    this.strategy = strategy;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.categories = categories;
    this._fetch = fetchImpl || globalThis.fetch;
  }

  /** Uma única tentativa de medição. */
  async _attempt(url) {
    const params = new URLSearchParams({ url, strategy: this.strategy });
    for (const c of this.categories) params.append("category", c);
    if (this.apiKey) params.set("key", this.apiKey);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const endpoint = this.baseUrl || ENDPOINT;
      const res = await this._fetch(`${endpoint}?${params}`, { signal: controller.signal });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const err = new Error(`PageSpeed HTTP ${res.status}`);
        err.status = res.status;
        err.retryable = res.status === 429 || res.status >= 500 || /FAILED_DOCUMENT_REQUEST/.test(body);
        throw err;
      }
      const data = await res.json();
      const report = buildReport(data);
      if (report.score === null) throw new Error("Resposta sem score de performance.");
      return report;
    } catch (e) {
      // Abort por timeout: site simplesmente lento. Não vale retry (gastaria
      // mais um timeout inteiro e prenderia um worker do pool em massa).
      if (e.name === "AbortError") {
        const err = new Error(`Tempo esgotado (>${Math.round(this.timeoutMs / 1000)}s)`);
        err.retryable = false;
        throw err;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Analisa uma URL e devolve o relatório completo, com retry em falha transitória.
   * @param {string} url
   * @returns {Promise<ReturnType<typeof buildReport>>}
   * @throws Error com mensagem curta se esgotar as tentativas.
   */
  async analyze(url) {
    const target = normalizeUrl(url);
    if (!target) throw new Error("URL vazia.");

    let lastError;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this._attempt(target);
      } catch (e) {
        lastError = e;
        if (!e.retryable || attempt === this.maxRetries) break;
        await sleep(1500 * (attempt + 1)); // backoff linear
      }
    }
    throw lastError;
  }
}
