/**
 * Caso de uso: transforma o relatório técnico do PageSpeed (cwv_report) em um
 * MODELO DE APRESENTAÇÃO persuasivo para o lead.
 *
 * Aqui mora a "tradução" dos termos secos (LCP, FCP, CLS, TBT...) para uma
 * narrativa de vendas: o que cada problema significa NA PRÁTICA e por que está
 * custando clientes. A ideia é que o vendedor consiga apresentar o relatório
 * para o dono do negócio sem ele precisar entender nada de tecnês.
 *
 * Função pura: recebe o lead enriquecido e devolve um objeto com textos prontos
 * + fragmentos de HTML (dimensões e contraste). Quem injeta isso no template é
 * a camada de infraestrutura (AuditReportRenderer).
 */

/** Faixa de qualidade de um score 0–100 (padrão Lighthouse). */
function gradeByScore(score) {
  if (score == null) return { tag: "warn", palavra: "Sem dado" };
  if (score >= 90) return { tag: "ok", palavra: "Bom" };
  if (score >= 50) return { tag: "warn", palavra: "Atenção" };
  return { tag: "red", palavra: "Crítico" };
}

/** Faixa de uma métrica por limiares (ok/warn/red) a partir do valor numérico. */
function gradeByThresholds(value, okMax, warnMax) {
  if (value == null) return { tag: "warn", palavra: "Sem dado" };
  if (value <= okMax) return { tag: "ok", palavra: "Bom" };
  if (value <= warnMax) return { tag: "warn", palavra: "Atenção" };
  return { tag: "red", palavra: "Crítico" };
}

/** Converte ms em "X,Y s" amigável quando o display da API não vier. */
function seconds(ms) {
  if (ms == null) return "—";
  return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
}

/** Escapa texto para uso seguro dentro do HTML. */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

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

/**
 * @param {import("../domain/Lead.js").Lead & { cwv_report?: any }} lead
 * @param {{ ctaUrl?: string, date?: string }} [opts]
 * @returns {Record<string,string>} modelo de placeholders para o template.
 */
export function buildAuditReportModel(lead, opts = {}) {
  const rep = lead.cwv_report || {};
  const cat = rep.categories || {};
  const m = rep.metrics || {};
  const nota = lead.nota ?? "—";
  const reviews = lead.avaliacoes ?? 0;
  const reviewsTxt = reviews ? `${reviews}` : "diversas";
  const date =
    opts.date ||
    new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
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

  // ---- Métricas e suas faixas ---------------------------------------------
  const lcpVal = m.lcp?.value ?? null;
  const tbtVal = m.tbt?.value ?? null;
  const clsVal = m.cls?.value ?? null;
  const lcpDisp = m.lcp?.display || seconds(lcpVal);
  const tbtDisp = m.tbt?.display || (tbtVal != null ? `${Math.round(tbtVal)} ms` : "—");
  const clsDisp = m.cls?.display || (clsVal != null ? clsVal.toFixed(2) : "—");

  const gLcp = gradeByThresholds(lcpVal, 2500, 4000);
  const gTbt = gradeByThresholds(tbtVal, 200, 600);
  const gCls = gradeByThresholds(clsVal, 0.1, 0.25);
  const gSeo = gradeByScore(cat.seo);
  const gA11y = gradeByScore(cat.accessibility);
  const gBp = gradeByScore(cat.bestPractices);

  // ---- Textos de topo (storytelling) --------------------------------------
  const subtitle = `Você construiu uma reputação que poucos concorrentes têm: ${nota}★ com ${esc(
    reviewsTxt
  )} avaliações. Este relatório mostra, ponto a ponto, por que o seu site ainda não está transformando essa reputação em clientes — e o que muda quando ele estiver à altura do seu atendimento.`;

  let resumo1;
  let resumo2;
  if (score10 < 5) {
    resumo1 =
      "Seu site está deixando dinheiro na mesa. A boa notícia é que o problema não é o seu negócio — é a vitrine digital, e isso tem conserto rápido.";
    resumo2 = `Sua nota ${nota}★ com ${esc(
      reviewsTxt
    )} avaliações coloca você entre os mais bem avaliados da sua região. Mas quem clica no seu site encontra uma experiência que não combina com essa qualidade — e vai embora antes de comprar.`;
  } else if (score10 < 8) {
    resumo1 =
      "Seu site funciona, mas está longe do potencial. Há pontos claros que, ajustados, destravam conversões que hoje escapam.";
    resumo2 = `Com ${nota}★ e ${esc(
      reviewsTxt
    )} avaliações, você atrai o cliente certo. Os ajustes abaixo garantem que ele não desista no meio do caminho.`;
  } else {
    resumo1 =
      "Seu site está num bom nível técnico — o que é raro. Ainda assim, há refinamentos que separam um site 'bom' de um que vende no automático.";
    resumo2 = `Sua reputação (${nota}★, ${esc(
      reviewsTxt
    )} avaliações) e um site sólido são uma combinação forte. Vamos potencializar o que já está bom.`;
  }

  // ---- Reputação (posição qualitativa) ------------------------------------
  let repRank = "Bem avaliado";
  if (typeof lead.nota === "number") {
    if (lead.nota >= 4.8) repRank = "Entre os melhores";
    else if (lead.nota >= 4.5) repRank = "Muito bem avaliado";
    else if (lead.nota >= 4) repRank = "Bem avaliado";
    else repRank = "Avaliado";
  }

  // ---- Contraste: o que o cliente encontra (lado vermelho) ----------------
  const contrasteRow = (label, value, tag) =>
    `<div style="display:flex;justify-content:space-between;align-items:baseline;"><span style="color:var(--muted);font-size:0.9rem;">${esc(
      label
    )}</span><span style="color:var(--${
      tag === "ok" ? "green" : "red"
    });font-weight:700;font-size:1.25rem;">${esc(value)}</span></div>`;
  const contrasteSite = [
    contrasteRow("Tempo até carregar", lcpDisp, gLcp.tag),
    contrasteRow("Nota de performance", `${cat.performance ?? "—"}/100`, gradeByScore(cat.performance).tag),
    contrasteRow("Resposta ao interagir", tbtDisp, gTbt.tag),
  ].join("");

  // ---- Diagnóstico ponto a ponto ------------------------------------------
  const dimensoes = [
    dimensionCard({
      nome: "Velocidade de carregamento",
      ...gLcp,
      valor: lcpDisp,
      unidade: "1ª tela no celular",
      pct: m.lcp?.score ?? 0,
      explicacao:
        gLcp.tag === "ok"
          ? `Seu site mostra o conteúdo principal em <strong>${esc(
              lcpDisp
            )}</strong> — dentro do recomendado pelo Google. Isso é um trunfo: o cliente que clica não espera, e o impulso de compra gerado pela sua reputação é preservado.`
          : `Seu site leva <strong>${esc(
              lcpDisp
            )}</strong> para mostrar o conteúdo principal no celular. O Google comprovou que, passando de 3 segundos, mais da metade das pessoas desiste antes da página abrir. Na prática: você tem ${esc(
              reviewsTxt
            )} avaliações e nota ${nota} — clientes que chegam querendo comprar, clicam no seu site e batem numa tela ainda em branco. Hoje, esse é provavelmente o maior ralo de oportunidades do seu negócio online.`,
    }),
    dimensionCard({
      nome: "Resposta ao toque",
      ...gTbt,
      valor: tbtDisp,
      unidade: "tempo travado",
      pct: m.tbt?.score ?? 0,
      explicacao:
        gTbt.tag === "ok"
          ? `Ao tocar em botões e rolar a página, o site responde na hora. Essa fluidez transmite a mesma confiança que as suas avaliações já passam.`
          : `Quando o cliente tenta tocar num botão ou rolar a tela, o site fica <strong>${esc(
              tbtDisp
            )}</strong> sem responder. Essa sensação de "travado" passa a impressão de um negócio frágil ou desatualizado — exatamente o oposto da confiança que as suas ${esc(
              reviewsTxt
            )} avaliações conquistaram.`,
    }),
    dimensionCard({
      nome: "Estabilidade visual",
      ...gCls,
      valor: clsDisp,
      unidade: "deslocamento de layout",
      pct: m.cls?.score ?? 0,
      explicacao:
        gCls.tag === "ok"
          ? `Os elementos ficam firmes enquanto a página carrega. O cliente clica onde quer, sem erros — uma experiência que não atrapalha a venda.`
          : `Enquanto a página carrega, os elementos "pulam" de lugar (índice ${esc(
              clsDisp
            )}). O cliente vai clicar em "agendar" ou "comprar" e acaba clicando em outra coisa. Essa frustração, repetida, faz muita gente simplesmente fechar o site.`,
    }),
    dimensionCard({
      nome: "Ser encontrado no Google",
      ...gSeo,
      valor: `${cat.seo ?? "—"}`,
      unidade: "score de SEO /100",
      pct: cat.seo ?? 0,
      explicacao:
        gSeo.tag === "ok"
          ? `Seu site está bem estruturado para o Google. Isso ajuda você a aparecer também para quem pesquisa pelo seu serviço, e não só no Maps.`
          : `Seu SEO está em <strong>${cat.seo ?? "—"}/100</strong>. Hoje você depende quase só do Google Maps para ser achado. Um site bem estruturado captura também quem digita o seu serviço no Google — clientes novos que, neste momento, vão direto para o concorrente que aparece na frente.`,
    }),
    dimensionCard({
      nome: "Experiência e acessibilidade",
      ...gA11y,
      valor: `${cat.accessibility ?? "—"}`,
      unidade: "acessibilidade /100",
      pct: cat.accessibility ?? 0,
      explicacao:
        gA11y.tag === "ok"
          ? `Seu site é fácil de ler e usar em qualquer tela. Como a maioria dos clientes acessa pelo celular, isso conta muito a seu favor.`
          : `A acessibilidade está em <strong>${cat.accessibility ?? "—"}/100</strong> — mede o quão fácil é ler e usar o site (contraste, tamanho de texto, navegação no celular). Boa parte dos seus clientes te procura pelo celular, muitas vezes na rua; problemas aqui afastam justamente quem está pronto para comprar agora.`,
    }),
    dimensionCard({
      nome: "Confiança e segurança",
      ...gBp,
      valor: `${cat.bestPractices ?? "—"}`,
      unidade: "boas práticas /100",
      pct: cat.bestPractices ?? 0,
      explicacao:
        gBp.tag === "ok"
          ? `Seu site segue os padrões modernos de segurança e qualidade. O cadeado de "site seguro" passa credibilidade já no primeiro segundo.`
          : `As boas práticas estão em <strong>${cat.bestPractices ?? "—"}/100</strong> — segurança e padrões modernos (HTTPS, imagens corretas, ausência de erros). Um aviso de "site não seguro" ou uma falha visível destrói, em segundos, a confiança que a sua reputação levou anos para construir.`,
    }),
  ].join("");

  // ---- O que isso custa ----------------------------------------------------
  let perdaEm10 = 2;
  if (lcpVal != null) {
    if (lcpVal > 5000) perdaEm10 = 6;
    else if (lcpVal > 4000) perdaEm10 = 5;
    else if (lcpVal > 3000) perdaEm10 = 3;
  }
  const impactoDestaque =
    score10 >= 8
      ? "Seu site preserva quase todos os clientes que sua reputação atrai — e ainda dá para subir essa régua."
      : `A cada 10 clientes que abrem seu site vindos do Google, cerca de <strong style="color:var(--accent);">${perdaEm10}</strong> desistem antes de ver a sua oferta.`;
  const impactoTexto =
    "Repare: não é falta de procura — sua reputação prova que a demanda existe. É a experiência do site que está barrando a venda no último passo. Recuperar essa fatia não exige gastar mais com anúncios; exige um site à altura do seu atendimento.";

  // ---- Próximo passo -------------------------------------------------------
  const proximoTitulo = "Seu site pode trabalhar tão bem quanto você atende.";
  const proximoTexto =
    "Reconstruímos a sua presença digital para carregar num piscar de olhos, funcionar perfeitamente no celular e transformar a sua reputação em agendamentos e vendas. Veja como o seu site ficaria.";

  return {
    LEAD_NAME: esc(lead.nome),
    LEAD_NAME_HTML: esc(lead.nome),
    DATE: esc(date),
    SUBTITLE: subtitle,
    SCORE_GERAL: String(score10),
    SCORE_DASHOFFSET: String(dashoffset),
    RESUMO_1: resumo1,
    RESUMO_2: resumo2,
    REP_RATING: esc(nota),
    REP_REVIEWS: esc(reviewsTxt),
    REP_RANK: esc(repRank),
    CONTRASTE_SITE: contrasteSite,
    DIMENSOES: dimensoes,
    IMPACTO_DESTAQUE: impactoDestaque,
    IMPACTO_TEXTO: impactoTexto,
    PROXIMO_TITULO: esc(proximoTitulo),
    PROXIMO_TEXTO: esc(proximoTexto),
    REBUILD_LINK: esc(ctaUrl),
  };
}
