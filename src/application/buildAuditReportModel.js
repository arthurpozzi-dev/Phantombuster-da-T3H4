/**
 * Caso de uso: transforma o relatório técnico do PageSpeed (cwv_report) em um
 * MODELO DE APRESENTAÇÃO persuasivo para o lead, no idioma escolhido.
 *
 * A "tradução" dos termos secos (LCP, FCP, CLS, TBT...) para a narrativa de
 * vendas vive nos dicionários de `reportI18n/` (um por idioma). Aqui ficam só o
 * CÁLCULO (faixas, score, perda estimada) e a FORMATAÇÃO localizada (número,
 * data, separador decimal). O resultado é o conjunto de placeholders + os
 * fragmentos de HTML que o AuditReportRenderer injeta no template.
 *
 * Função pura: recebe o lead enriquecido + o locale e devolve o modelo.
 */
import { getReportLocale, DEFAULT_LOCALE } from "./reportI18n/index.js";

/** Contatos do CTA final do relatório (botão "ver a prévia"). */
const CTA_WHATSAPP_NUMBER = "5511991636020"; // +55 11 99163-6020
const CTA_EMAIL = "t3h4.studios@gmail.com";

/**
 * Monta o link do botão final conforme o idioma: WhatsApp (com mensagem
 * traduzida) ou e-mail (mailto com assunto + corpo). Cai no `fallback` se o
 * locale não definir um CTA.
 */
function buildCtaHref(cta, fallback) {
  if (cta?.type === "whatsapp")
    return `https://wa.me/${CTA_WHATSAPP_NUMBER}?text=${encodeURIComponent(cta.message)}`;
  if (cta?.type === "email")
    return `mailto:${CTA_EMAIL}?subject=${encodeURIComponent(cta.subject)}&body=${encodeURIComponent(cta.message)}`;
  return fallback;
}

/** Faixa de qualidade de um score 0–100 (padrão Lighthouse). */
function gradeByScore(score) {
  if (score == null) return { tag: "warn", missing: true };
  if (score >= 90) return { tag: "ok" };
  if (score >= 50) return { tag: "warn" };
  return { tag: "red" };
}

/** Faixa de uma métrica por limiares (ok/warn/red) a partir do valor numérico. */
function gradeByThresholds(value, okMax, warnMax) {
  if (value == null) return { tag: "warn", missing: true };
  if (value <= okMax) return { tag: "ok" };
  if (value <= warnMax) return { tag: "warn" };
  return { tag: "red" };
}

/** Troca o separador decimal "." pelo do locale (ex.: vírgula em pt/es). */
const dec = (s, decimal) => String(s).replace(".", decimal);

/** Converte ms em "X,Y s" / "X.Y s" conforme o locale. */
function seconds(ms, decimal) {
  if (ms == null) return "—";
  return `${dec((ms / 1000).toFixed(1), decimal)} s`;
}

/** Escapa texto para uso seguro dentro do HTML. */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

/** Palavra da faixa, no idioma (ou "sem dado" quando a métrica não veio). */
const gradeWord = (g, S) => (g.missing ? S.grade.none : S.grade[g.tag]);

/** Card de uma dimensão do diagnóstico (HTML). */
function dimensionCard({ nome, palavra, tag, valor, unidade, pct, explicacao }) {
  const width = Math.max(4, Math.min(100, Math.round(pct ?? 0)));
  return `
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;margin-bottom:1rem;">
      <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;">
        <h3 style="font-size:1.1rem;font-weight:600;color:#fff;margin:0;">${esc(nome)}</h3>
        <span class="tag ${tag}">${esc(palavra)}</span>
      </div>
      <div style="text-align:right;flex-shrink:0;">
        <div class="font-mono" style="font-size:1.4rem;font-weight:700;color:#fff;">${esc(valor)}</div>
        <div class="font-mono" style="font-size:0.58rem;color:var(--muted-2);text-transform:uppercase;letter-spacing:0.1em;">${esc(unidade)}</div>
      </div>
    </div>
    <div class="bar" style="margin-bottom:1.1rem;"><span class="${tag}" style="width:${width}%"></span></div>
    <p style="color:var(--muted);font-size:0.95rem;line-height:1.65;margin:0;">${explicacao}</p>
  </div>`;
}

/** Linha do bloco "o que o cliente encontra" (HTML). */
function contrasteRow(label, value, tag) {
  return `<div style="display:flex;justify-content:space-between;align-items:baseline;"><span style="color:var(--muted);font-size:0.9rem;">${esc(
    label
  )}</span><span style="color:var(--${
    tag === "ok" ? "green" : "red"
  });font-weight:700;font-size:1.25rem;">${esc(value)}</span></div>`;
}

/**
 * @param {import("../domain/Lead.js").Lead & { cwv_report?: any }} lead
 * @param {{ ctaUrl?: string, date?: string, locale?: string }} [opts]
 * @returns {Record<string,string>} modelo de placeholders para o template.
 */
export function buildAuditReportModel(lead, opts = {}) {
  const L = getReportLocale(opts.locale || DEFAULT_LOCALE);
  const decimal = L.decimal;

  const rep = lead.cwv_report || {};
  const cat = rep.categories || {};
  const m = rep.metrics || {};
  const notaDisp = typeof lead.nota === "number" ? dec(lead.nota, decimal) : "—";
  const reviews = typeof lead.avaliacoes === "number" ? lead.avaliacoes : 0;
  const date =
    opts.date ||
    new Date().toLocaleDateString(L.localeCode, { day: "2-digit", month: "long", year: "numeric" });
  const ctaUrl = opts.ctaUrl || "https://t3h4.com.br";

  // ---- Score geral (0–10) ponderado entre as categorias --------------------
  const parts = [
    [cat.performance, 0.5],
    [cat.seo, 0.2],
    [cat.bestPractices, 0.15],
    [cat.accessibility, 0.15],
  ];
  let sum = 0;
  let weight = 0;
  for (const [v, w] of parts) if (typeof v === "number") (sum += v * w), (weight += w);
  const score100 = weight ? sum / weight : cat.performance || 0;
  const score10 = Math.round((score100 / 10) * 10) / 10;
  const circ = 2 * Math.PI * 52;
  const dashoffset = (circ * (1 - score10 / 10)).toFixed(1);
  const band = score10 < 5 ? "low" : score10 < 8 ? "mid" : "high";

  // ---- Métricas, faixas e exibição localizada ------------------------------
  const lcpVal = m.lcp?.value ?? null;
  const tbtVal = m.tbt?.value ?? null;
  const clsVal = m.cls?.value ?? null;
  const lcpDisp = lcpVal != null ? seconds(lcpVal, decimal) : m.lcp?.display || "—";
  const tbtDisp = tbtVal != null ? `${Math.round(tbtVal)} ms` : m.tbt?.display || "—";
  const clsDisp = clsVal != null ? dec(clsVal.toFixed(2), decimal) : m.cls?.display || "—";

  const gLcp = gradeByThresholds(lcpVal, 2500, 4000);
  const gTbt = gradeByThresholds(tbtVal, 200, 600);
  const gCls = gradeByThresholds(clsVal, 0.1, 0.25);
  const gSeo = gradeByScore(cat.seo);
  const gA11y = gradeByScore(cat.accessibility);
  const gBp = gradeByScore(cat.bestPractices);
  const gPerf = gradeByScore(cat.performance);

  // ---- Reputação (posição qualitativa) ------------------------------------
  let rankKey = "good";
  if (typeof lead.nota === "number") {
    if (lead.nota >= 4.8) rankKey = "best";
    else if (lead.nota >= 4.5) rankKey = "veryGood";
    else if (lead.nota >= 4) rankKey = "good";
    else rankKey = "rated";
  }

  // ---- Perda estimada (a cada 10 visitantes) ------------------------------
  let perdaEm10 = 2;
  if (lcpVal != null) {
    if (lcpVal > 5000) perdaEm10 = 6;
    else if (lcpVal > 4000) perdaEm10 = 5;
    else if (lcpVal > 3000) perdaEm10 = 3;
  }

  // ---- Textos do idioma escolhido -----------------------------------------
  const ctx = {
    notaDisp,
    reviews,
    score10,
    band,
    perdaEm10,
    lcpDisp,
    tbtDisp,
    clsDisp,
    perf: cat.performance ?? "—",
    seo: cat.seo ?? "—",
    a11y: cat.accessibility ?? "—",
    bp: cat.bestPractices ?? "—",
    tag: { lcp: gLcp.tag, tbt: gTbt.tag, cls: gCls.tag, seo: gSeo.tag, a11y: gA11y.tag, bp: gBp.tag },
  };
  const S = L.strings(ctx);

  // ---- Contraste: o que o cliente encontra (lado vermelho) ----------------
  const contrasteSite = [
    contrasteRow(S.contraste.tempoCarregar, lcpDisp, gLcp.tag),
    contrasteRow(S.contraste.notaPerf, `${ctx.perf}/100`, gPerf.tag),
    contrasteRow(S.contraste.respInteragir, tbtDisp, gTbt.tag),
  ].join("");

  // ---- Diagnóstico ponto a ponto ------------------------------------------
  const dimSpec = [
    [gLcp, "lcp", lcpDisp, m.lcp?.score],
    [gTbt, "tbt", tbtDisp, m.tbt?.score],
    [gCls, "cls", clsDisp, m.cls?.score],
    [gSeo, "seo", `${ctx.seo}`, cat.seo],
    [gA11y, "a11y", `${ctx.a11y}`, cat.accessibility],
    [gBp, "bp", `${ctx.bp}`, cat.bestPractices],
  ];
  const dimensoes = dimSpec
    .map(([g, key, valor, pct]) =>
      dimensionCard({
        nome: S.dims[key].title,
        palavra: gradeWord(g, S),
        tag: g.tag,
        valor,
        unidade: S.dims[key].unit,
        pct: pct ?? 0,
        explicacao: S.dims[key].explain,
      })
    )
    .join("");

  return {
    HTML_LANG: L.htmlLang,
    DOC_TITLE: esc(`${S.tagline} — ${lead.nome}`),
    TAGLINE: esc(S.tagline),
    KICKER_AUDIT: esc(S.kickerAudit),
    LABEL_OVERALL: esc(S.overall),
    LABEL_OUT_OF_10: esc(S.outOf10),
    SEC_REP_VS_SITE: esc(S.secRepVsSite),
    LABEL_WHAT_BUILT: esc(S.whatBuilt),
    LABEL_GOOGLE_RATING: esc(S.googleRating),
    LABEL_NUM_REVIEWS: esc(S.numReviews),
    LABEL_REPUTATION: esc(S.reputation),
    LABEL_WHAT_CLIENT_FINDS: esc(S.whatClientFinds),
    SEC_DIAGNOSIS: esc(S.secDiagnosis),
    SEC_COST: esc(S.secCost),
    LABEL_CONSERVATIVE_EST: esc(S.conservativeEst),
    LABEL_NEXT_STEP: esc(S.nextStep),
    CTA_REBUILD: esc(S.ctaRebuild),
    FOOTER_GENERATED: `${esc(S.footerPrefix)} ${esc(date)} · t3h4.com.br`,

    LEAD_NAME: esc(lead.nome),
    LEAD_NAME_HTML: esc(lead.nome),
    DATE: esc(date),
    SUBTITLE: S.subtitle,
    SCORE_GERAL: String(score10),
    SCORE_DASHOFFSET: String(dashoffset),
    RESUMO_1: S.resumo1,
    RESUMO_2: S.resumo2,
    REP_RATING: esc(notaDisp),
    REP_REVIEWS: esc(reviews ? String(reviews) : S.reviewsFallback),
    REP_RANK: esc(S.rank[rankKey]),
    CONTRASTE_SITE: contrasteSite,
    DIMENSOES: dimensoes,
    IMPACTO_DESTAQUE: S.impactoDestaque,
    IMPACTO_TEXTO: S.impactoTexto,
    PROXIMO_TITULO: esc(S.proximoTitulo),
    PROXIMO_TEXTO: esc(S.proximoTexto),
    REBUILD_LINK: esc(buildCtaHref(L.cta, ctaUrl)),
  };
}
