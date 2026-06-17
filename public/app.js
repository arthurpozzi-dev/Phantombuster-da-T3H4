/**
 * Front-end do Maps Leads Scraper.
 *
 * Conversa com o servidor por Server-Sent Events (SSE):
 *   /api/scrape    -> coleta + pipeline de N buscas (um link/termo por linha)
 *   /api/enrich    -> Core Web Vitals (todas as buscas)
 *   /api/sitetext  -> texto dos sites (todas as buscas)
 * E exporta tudo num pacote por /api/export/:id.zip (ou planilhas avulsas por busca).
 */
const $ = (id) => document.getElementById(id);

// Colunas exibidas em cada tabela: [chave, rótulo, tipoOpcional].
const COLS_COM = [
  ["nome", "Nome"], ["categoria", "Categoria"], ["nota", "Nota"],
  ["avaliacoes", "Avaliações"], ["telefone", "Telefone"], ["whatsapp", "WhatsApp", "link"],
  ["endereco", "Endereço"],
  ["site", "Site", "link"], ["redes_sociais", "Redes", "links"],
  ["site_emails", "E-mails", "emails"],
  ["cwv_score", "Perf."], ["cwv_status", "Status", "cwv"],
  ["cwv_report", "Relatório", "report"],
  ["descricao", "Descrição"], ["link_maps", "Maps", "link"],
];
const COLS_SEM = [
  ["nome", "Nome"], ["categoria", "Categoria"], ["nota", "Nota"],
  ["avaliacoes", "Avaliações"], ["telefone", "Telefone"], ["whatsapp", "WhatsApp", "link"],
  ["endereco", "Endereço"],
  ["redes_sociais", "Redes", "links"], ["descricao", "Descrição"], ["link_maps", "Maps", "link"],
];

// Estado da execução atual.
const state = { id: null, buscas: [], current: 0 };
let scrapeES = null;
let jobES = null; // SSE de enrich/sitetext (compartilham a barra)

// Botões de job (compartilham a barra de progresso de enriquecimento).
const JOB_BTNS = ["enrich", "sitetext", "emailScrape", "socialScrape"];
const setJobBtns = (disabled) => JOB_BTNS.forEach((id) => ($(id).disabled = disabled));

const setStatus = (msg) => ($("status").textContent = msg);
const setBar = (id, fillId, pct) => {
  const b = $(id);
  b.style.display = pct == null ? "none" : "block";
  if (pct != null) $(fillId).style.width = pct + "%";
};

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "link"; }
}

/** Cor (classe) de um score 0–100 nas faixas do Lighthouse. */
function scoreClass(v) {
  if (v == null || v === "") return "cwv-NA";
  return v >= 90 ? "cwv-BOM" : v >= 50 ? "cwv-MÉDIO" : "cwv-RUIM";
}

/** Renderiza uma célula conforme o tipo da coluna. */
function renderCell(value, type, row) {
  const v = value === null || value === undefined ? "" : value;
  if (!v && v !== 0) return "";
  if (type === "link") return `<a href="${v}" target="_blank" rel="noopener">link</a>`;
  if (type === "links") {
    const fontes = (row && row.redes_fontes) || {};
    return String(v)
      .split(" | ")
      .filter(Boolean)
      .map((u) => {
        const link = `<a href="${u}" target="_blank" rel="noopener">${hostOf(u)}</a>`;
        // Descoberto por busca web: pode ser homônimo — sinaliza para conferência.
        return fontes[u] === "busca"
          ? `${link} <span title="Descoberto por busca web — confira se é o perfil certo" style="cursor:help">⚠️</span>`
          : link;
      })
      .join("<br>");
  }
  if (type === "emails")
    return String(v)
      .split(" | ")
      .filter(Boolean)
      .map((e) => `<a href="mailto:${e}">${e}</a>`)
      .join("<br>");
  if (type === "cwv") {
    let cls = "cwv-NA";
    if (v === "BOM" || v === "MÉDIO" || v === "RUIM") cls = `cwv-${v}`;
    else if (v === "FORA DO AR") cls = "cwv-fora";
    const title = row && row.cwv_erro ? ` title="${String(row.cwv_erro).replace(/"/g, "'")}"` : "";
    return `<span class="cwv ${cls}"${title}>${v}</span>`;
  }
  if (type === "report") {
    if (!value) return ""; // sem relatório (lead ainda não enriquecido ou N/A)
    const idx = row && row.__idx != null ? row.__idx : "";
    return (
      `<button class="ghost mini" onclick="toggleReport(this)">📊 ver</button> ` +
      `<button class="ghost mini" onclick="openSalesReport(${idx})" title="Relatório persuasivo para apresentar ao lead">📄 venda</button>`
    );
  }
  return String(v);
}

/** Abre, em nova aba, o relatório de auditoria persuasivo de um lead (busca atual). */
function openSalesReport(index) {
  if (!state.id || index === "") return;
  window.open(`/api/report/${state.id}/lead/${state.current}/${index}.html`, "_blank", "noopener");
}
window.openSalesReport = openSalesReport;

/** Monta o HTML do relatório técnico detalhado de um lead enriquecido. */
function renderReport(rep, row) {
  const c = rep.categories;
  const chip = (label, val) =>
    `<div class="repScore"><b class="cwv ${scoreClass(val)}">${val == null ? "—" : val}</b><span>${label}</span></div>`;
  const m = rep.metrics;
  const mRow = (label, x) =>
    x && x.display
      ? `<tr><td>${label}</td><td>${x.display}</td><td><span class="cwv ${scoreClass(x.score)}">${x.score ?? ""}</span></td></tr>`
      : "";

  const labHtml =
    `<h4>Métricas (laboratório)</h4>` +
    `<table class="repTable"><thead><tr><th>Métrica</th><th>Valor</th><th>Score</th></tr></thead><tbody>` +
    mRow("LCP — Largest Contentful Paint", m.lcp) +
    mRow("FCP — First Contentful Paint", m.fcp) +
    mRow("CLS — Cumulative Layout Shift", m.cls) +
    mRow("TBT — Total Blocking Time", m.tbt) +
    mRow("Speed Index", m.si) +
    mRow("TTI — Time to Interactive", m.tti) +
    `</tbody></table>`;

  let fieldHtml;
  if (rep.field) {
    const f = rep.field;
    const fRow = (label, x) =>
      x ? `<tr><td>${label}</td><td>${x.percentile ?? "—"}</td><td>${x.category || ""}</td></tr>` : "";
    fieldHtml =
      `<h4>Dados de campo · usuários reais (CrUX) — ${f.overall || ""}</h4>` +
      `<table class="repTable"><thead><tr><th>Métrica</th><th>Percentil (p75)</th><th>Faixa</th></tr></thead><tbody>` +
      fRow("LCP", f.lcp) + fRow("INP", f.inp) + fRow("CLS", f.cls) + fRow("FCP", f.fcp) + fRow("TTFB", f.ttfb) +
      `</tbody></table>`;
  } else {
    fieldHtml = `<h4>Dados de campo (CrUX)</h4><p class="empty">Sem amostra suficiente de usuários reais para este site.</p>`;
  }

  const ops = rep.opportunities?.length
    ? `<h4>Oportunidades de melhoria</h4><ul class="repOps">` +
      rep.opportunities.map((o) => `<li><b>${o.title}</b>${o.display ? ` — ${o.display}` : ""}</li>`).join("") +
      `</ul>`
    : "";

  const psi = "https://pagespeed.web.dev/analysis?url=" + encodeURIComponent(row.site || "");

  return (
    `<div class="report">` +
    `<div class="repScores">${chip("Performance", c.performance)}${chip("Acessibilidade", c.accessibility)}${chip("Boas Práticas", c.bestPractices)}${chip("SEO", c.seo)}</div>` +
    `<div class="repCols"><div>${labHtml}</div><div>${fieldHtml}</div></div>` +
    ops +
    `<p><a href="${psi}" target="_blank" rel="noopener">Abrir relatório completo no PageSpeed ↗</a></p>` +
    `</div>`
  );
}

/** Mostra/esconde a linha de relatório logo abaixo da linha clicada. */
function toggleReport(btn) {
  const tr = btn.closest("tr");
  const detail = tr.nextElementSibling;
  if (!detail || !detail.classList.contains("reportRow")) return;
  const show = detail.style.display === "none";
  detail.style.display = show ? "table-row" : "none";
  btn.textContent = show ? "📊 fechar" : "📊 ver";
}
window.toggleReport = toggleReport;

function renderTable(tableId, cols, rows) {
  const table = $(tableId);
  table.querySelector("thead").innerHTML =
    "<tr>" + cols.map((c) => `<th>${c[1]}</th>`).join("") + "</tr>";

  if (!rows.length) {
    table.querySelector("tbody").innerHTML =
      `<tr><td colspan="${cols.length}" class="empty">Nada nesta lista.</td></tr>`;
    return;
  }

  table.querySelector("tbody").innerHTML = rows
    .map((r, i) => {
      r.__idx = i; // posição na lista (usada pelo botão de relatório por item)
      const main =
        "<tr>" + cols.map(([k, , type]) => `<td>${renderCell(r[k], type, r)}</td>`).join("") + "</tr>";
      const detail = r.cwv_report
        ? `<tr class="reportRow" style="display:none"><td colspan="${cols.length}">${renderReport(r.cwv_report, r)}</td></tr>`
        : "";
      return main + detail;
    })
    .join("");
}

/**
 * Calcula o resumo COMPLETO de um conjunto de buscas. Como tudo é derivado das
 * listas (atualizadas a cada operação — enriquecer, e-mails, texto), passar uma
 * busca dá o resumo dela; passar todas dá o total global. As seções de
 * performance, e-mail e texto só aparecem depois que a operação rodou.
 * @returns {[string, number|string][]} pares [rótulo, valor]
 */
function summaryItems(buscas) {
  const com = buscas.flatMap((b) => b.comSite || []);
  const sem = buscas.flatMap((b) => b.semSite || []);
  const sumStat = (k) => buscas.reduce((s, b) => s + (b.stats?.[k] ?? 0), 0);
  const hasStat = (k) => buscas.some((b) => b.stats && b.stats[k] != null);

  const nonEmpty = (v) => String(v || "").trim() !== "";
  const emailsDe = (l) => String(l.site_emails || "").split(" | ").filter(Boolean);
  const countStatus = (s) => com.filter((l) => (l.cwv_status || "") === s).length;

  const comEmail = com.filter((l) => nonEmpty(l.site_emails)).length;
  const totalEmails = com.reduce((s, l) => s + emailsDe(l).length, 0);
  const comTexto = com.filter((l) => nonEmpty(l.site_texto)).length;
  const enriquecidos = com.some((l) => nonEmpty(l.cwv_status));
  const emailsRodou = com.some((l) => nonEmpty(l.site_emails) || nonEmpty(l.site_emails_erro));
  const textoRodou = com.some((l) => nonEmpty(l.site_texto) || nonEmpty(l.site_texto_erro));

  // Funil do pipeline (sempre).
  const items = [
    ["Coletados", hasStat("bruto") ? sumStat("bruto") : "—"],
    ["Após limpeza", hasStat("limpos") ? sumStat("limpos") : "—"],
    ["Após filtro", hasStat("filtrados") ? sumStat("filtrados") : "—"],
    ["Com site", com.length],
    ["Sem site", sem.length],
  ];
  // Performance (só depois de enriquecer os sites).
  if (enriquecidos) {
    items.push(
      ["Perf. boa", countStatus("BOM")],
      ["Perf. média", countStatus("MÉDIO")],
      ["Perf. ruim", countStatus("RUIM")],
      ["Fora do ar", countStatus("FORA DO AR")],
      ["Sem dados", countStatus("N/A")]
    );
  }
  // E-mails (só depois de enriquecer e-mails).
  if (emailsRodou) items.push(["Com e-mail", comEmail], ["Total de e-mails", totalEmails]);
  // Texto dos sites (só depois de puxar o texto).
  if (textoRodou) items.push(["Com texto", comTexto]);

  return items;
}

/** Pinta os chips de estatística num container. */
function renderStatItems(containerId, items) {
  $(containerId).innerHTML = items
    .map(([label, n]) => `<div class="stat"><b>${n}</b><span>${label}</span></div>`)
    .join("");
}

/** Painel global: soma de TODAS as buscas (aparece só quando há mais de uma). */
function renderGlobalSummary() {
  const show = state.buscas.length > 1;
  $("summaryGlobalWrap").style.display = show ? "" : "none";
  $("summaryCurrentLabel").style.display = show ? "" : "none";
  if (show) renderStatItems("summaryGlobal", summaryItems(state.buscas));
}

/** Renderiza a busca atualmente selecionada. */
function renderCurrent() {
  const b = state.buscas[state.current];
  if (!b) return;
  renderStatItems("summary", summaryItems([b]));
  $("countCom").textContent = (b.comSite || []).length;
  $("countSem").textContent = (b.semSite || []).length;
  renderGlobalSummary();
  renderTable("tableCom", COLS_COM, b.comSite);
  renderTable("tableSem", COLS_SEM, b.semSite);
}

/** Popula o seletor de buscas (visível quando há mais de uma). */
function setupBuscaPicker() {
  const sel = $("buscaSel");
  sel.innerHTML = state.buscas
    .map((b, i) => {
      const rotulo = (b.query || `Busca ${i + 1}`).slice(0, 60);
      return `<option value="${i}">${i + 1}. ${rotulo} — ${b.stats.comSite} com / ${b.stats.semSite} sem</option>`;
    })
    .join("");
  sel.value = String(state.current);
  $("buscaPicker").style.display = state.buscas.length > 1 ? "block" : "none";
}

// ---- Busca + pipeline (N buscas) -----------------------------------------
function start() {
  const input = $("input").value.trim();
  const mode = $("mode").value;
  const isGrade = mode === "grid" || mode === "city";

  if (!input) return setStatus("Informe ao menos um termo de busca.");

  // Em modos grade, a textarea é só para palavras-chave — rejeita URLs do Maps.
  if (isGrade && /^https?:\/\//im.test(input))
    return setStatus("No modo grade, a caixa de texto aceita apenas palavras-chave (ex.: \"restaurantes\"). Coloque links do Maps no campo de localização abaixo.");

  if (mode === "grid" && !$("center").value.trim())
    return setStatus("Informe a localização (lat,lng ou link do Maps com @lat,lng).");
  if (mode === "city" && !$("cityName").value.trim())
    return setStatus("Informe o nome da cidade.");

  if (scrapeES) scrapeES.close();

  $("go").disabled = true;
  $("resultsCard").style.display = "none";
  setStatus("Iniciando...");
  setBar("bar", "barfill", 2);

  const params = new URLSearchParams({
    input,
    mode,
    max: parseInt($("max").value, 10) || 0,
    deep: $("deep").checked ? "1" : "0",
    minAval: $("minAval").value,
    maxAval: $("maxAval").value,
    notaMin: $("notaMin").value,
  });
  if (mode === "grid") {
    params.set("center", $("center").value.trim());
    params.set("area", $("area").value || "0.05");
    params.set("step", $("step").value || "0.04");
  } else if (mode === "city") {
    params.set("city", $("cityName").value.trim());
    params.set("area", $("cityArea").value || "0.05");
    params.set("step", $("cityStep").value || "0.04");
  }
  scrapeES = new EventSource(`/api/scrape?${params}`);

  scrapeES.addEventListener("progress", (e) => {
    const p = JSON.parse(e.data);
    if (p.message) setStatus(p.message + (p.found != null ? `  (${p.found})` : ""));
    if (p.phase === "scroll" && p.found != null) setBar("bar", "barfill", Math.min(40, 5 + p.found));
    if (p.phase === "detail" && p.total)
      setBar("bar", "barfill", 40 + Math.round((60 * p.current) / p.total));
  });

  scrapeES.addEventListener("done", (e) => {
    const d = JSON.parse(e.data);
    state.id = d.id;
    state.buscas = d.buscas;
    state.current = 0;
    setBar("bar", "barfill", 100);
    const totalLeads = d.buscas.reduce((s, b) => s + b.stats.comSite + b.stats.semSite, 0);
    const dups = d.duplicatasRemovidas
      ? ` (${d.duplicatasRemovidas} duplicata(s) entre buscas removida(s))`
      : "";
    setStatus(`Concluído: ${d.buscas.length} busca(s), ${totalLeads} leads sem duplicatas${dups}.`);

    setupBuscaPicker();
    renderCurrent();
    $("resultsCard").style.display = "block";

    const totalCom = d.buscas.reduce((s, b) => s + b.stats.comSite, 0);
    setJobBtns(totalCom === 0);
    $("go").disabled = false;
    scrapeES.close();
    setTimeout(() => setBar("bar", "barfill", null), 1200);
  });

  scrapeES.addEventListener("error", (e) => {
    let msg = "Erro de conexão com o servidor.";
    try { if (e.data) msg = JSON.parse(e.data).message; } catch {}
    setStatus("❌ " + msg);
    $("go").disabled = false;
    setBar("bar", "barfill", null);
    scrapeES.close();
  });
}

// ---- Job SSE genérico (enrich / sitetext) --------------------------------
function runJob(url, { startMsg, progressMsg, doneMsg }) {
  if (!state.id) return;
  if (jobES) jobES.close();
  setJobBtns(true);
  $("enrichStatus").textContent = startMsg;
  setBar("enrichBar", "enrichFill", 2);

  jobES = new EventSource(url);

  jobES.addEventListener("progress", (e) => {
    const p = JSON.parse(e.data);
    $("enrichStatus").textContent = progressMsg(p);
    if (p.total) setBar("enrichBar", "enrichFill", Math.round((100 * p.current) / p.total));
  });

  jobES.addEventListener("done", (e) => {
    const d = JSON.parse(e.data);
    // Atualiza o comSite/semSite de cada busca com os dados enriquecidos.
    if (Array.isArray(d.comSitePerBusca))
      d.comSitePerBusca.forEach((cs, i) => { if (state.buscas[i]) state.buscas[i].comSite = cs; });
    if (Array.isArray(d.semSitePerBusca))
      d.semSitePerBusca.forEach((ss, i) => { if (state.buscas[i]) state.buscas[i].semSite = ss; });
    renderCurrent();
    $("enrichStatus").textContent = doneMsg(d);
    setBar("enrichBar", "enrichFill", 100);
    setJobBtns(false);
    jobES.close();
    setTimeout(() => setBar("enrichBar", "enrichFill", null), 1500);
  });

  jobES.addEventListener("error", (e) => {
    let msg = "Erro na operação.";
    try { if (e.data) msg = JSON.parse(e.data).message; } catch {}
    $("enrichStatus").textContent = "❌ " + msg;
    setJobBtns(false);
    setBar("enrichBar", "enrichFill", null);
    jobES.close();
  });
}

function enrich() {
  const deep = $("deepCwv").checked;
  const params = new URLSearchParams({
    key: $("key").value.trim(),
    conc: parseInt($("conc").value, 10) || 12,
  });
  if (deep) params.set("deep", "1");
  runJob(`/api/enrich/${state.id}?${params}`, {
    startMsg: deep ? "Analisando sites (Lighthouse completo)..." : "Analisando sites (modo rápido: CrUX + performance)...",
    progressMsg: (p) => `${p.status === "FORA DO AR" ? "Fora do ar" : "PageSpeed"} ${p.current}/${p.total}: ${p.nome}`,
    doneMsg: (d) => {
      const partes = [`${d.ok} sites medidos`];
      if (d.foraDoAr) partes.push(`${d.foraDoAr} fora do ar`);
      if (d.falhas) partes.push(`${d.falhas} sem dados`);
      return `✅ ${partes.join(", ")} (passe o mouse no status para o motivo).`;
    },
  });
}

function sitetext() {
  const params = new URLSearchParams({ conc: parseInt($("conc").value, 10) || 8 });
  runJob(`/api/sitetext/${state.id}?${params}`, {
    startMsg: "Puxando o texto dos sites...",
    progressMsg: (p) => `Texto ${p.current}/${p.total}: ${p.nome}`,
    doneMsg: (d) =>
      d.falhas > 0
        ? `✅ Texto de ${d.ok} sites, ${d.falhas} sem texto (veja a coluna na planilha).`
        : `✅ Texto de ${d.ok} sites coletado.`,
  });
}

function emailScrape() {
  const params = new URLSearchParams({ conc: parseInt($("conc").value, 10) || 6 });
  // Fallback com navegador (sites JS): roda só nos leads que ficarem sem e-mail.
  if (!$("renderJs").checked) params.set("render", "0");
  runJob(`/api/emails/${state.id}?${params}`, {
    startMsg: "Buscando e-mails (home + páginas de contato)...",
    progressMsg: (p) => {
      const rotulo = p.fase === "navegador" ? "Renderizando (sites JS)" : "E-mails";
      return `${rotulo} ${p.current}/${p.total}: ${p.nome}` + (p.encontrados ? ` (${p.encontrados})` : "");
    },
    doneMsg: (d) => {
      const partes = [`${d.ok} com e-mail`];
      if (d.renderizados) partes.push(`${d.renderizados} via navegador`);
      if (d.semEmail) partes.push(`${d.semEmail} sem e-mail`);
      if (d.falhas) partes.push(`${d.falhas} falharam`);
      return `✅ ${partes.join(", ")} (veja a coluna E-mails).`;
    },
  });
}

function socialScrape() {
  const params = new URLSearchParams({ conc: parseInt($("conc").value, 10) || 6 });
  // Fallback com navegador (sites JS) e busca web (descoberta) — opcionais.
  if (!$("renderJs").checked) params.set("render", "0");
  if ($("searchSocials").checked) params.set("search", "1");
  runJob(`/api/socials/${state.id}?${params}`, {
    startMsg: "Procurando redes sociais (site + páginas de contato)...",
    progressMsg: (p) => {
      const rotulo =
        p.fase === "navegador" ? "Renderizando (sites JS)" : p.fase === "busca" ? "Buscando na web" : "Redes";
      return `${rotulo} ${p.current}/${p.total}: ${p.nome}` + (p.encontrados ? ` (${p.encontrados})` : "");
    },
    doneMsg: (d) => {
      const partes = [`${d.ok} com rede social`];
      if (d.viaBusca) partes.push(`${d.viaBusca} via busca web`);
      if (d.semRedes) partes.push(`${d.semRedes} sem rede`);
      if (d.falhas) partes.push(`${d.falhas} falharam`);
      return `✅ ${partes.join(", ")} (veja a coluna Redes).`;
    },
  });
}

// ---- Abas, seletor e downloads -------------------------------------------
function setupTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      $(`panel-${tab.dataset.tab}`).classList.add("active");
    });
  });
}

function setupDownloads() {
  document.querySelectorAll("[data-dl]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!state.id) return;
      location.href = `/api/download/${state.id}/${state.current}/${btn.dataset.dl}.${btn.dataset.ext}`;
    });
  });
}

// ---- Modal de exportação configurável ------------------------------------
let exportCols = null; // { "com-site":[{key,header}], "sem-site":[...] }, carregado 1x

/** Renderiza os checkboxes de colunas (todas marcadas) num container. */
function renderColCheckboxes(containerId, cols) {
  $(containerId).innerHTML = cols
    .map(
      (c) =>
        `<label class="check"><input type="checkbox" value="${c.key}" ${c.default === false ? "" : "checked"} /> ${c.header}</label>`
    )
    .join("");
}

/** Garante que as colunas foram buscadas do servidor e os checkboxes montados. */
async function ensureExportCols() {
  if (exportCols) return;
  const res = await fetch("/api/columns");
  exportCols = await res.json();
  renderColCheckboxes("ex-cols-com", exportCols["com-site"]);
  renderColCheckboxes("ex-cols-sem", exportCols["sem-site"]);
}

/** Status de performance marcados no modal (lista "com site"). */
function selectedStatuses() {
  return [...document.querySelectorAll("#ex-status-group input:checked")].map((i) => i.value);
}

/** Status de um lead, tratando "não medido" (vazio) como "N/A". */
function statusOf(lead) {
  const s = String(lead.cwv_status || "").trim();
  return s === "" ? "N/A" : s;
}

/** Soma de leads por lista, conforme abrangência, filtro de e-mail e de status. */
function exportCounts() {
  const buscas = $("ex-scope").value === "current" ? [state.buscas[state.current]] : state.buscas;
  const onlyEmail = $("ex-only-email").checked;
  const statuses = selectedStatuses();
  const allStatus = statuses.length === 0 || statuses.length >= 5;
  const has = (l) => String(l.site_emails || "").trim() !== "";
  const okStatus = (l) => allStatus || statuses.includes(statusOf(l));
  const nCom = (rows) => rows.filter((l) => (!onlyEmail || has(l)) && okStatus(l)).length;
  const nSem = (rows) => (onlyEmail ? rows.filter(has).length : rows.length);
  return buscas.filter(Boolean).reduce(
    (acc, b) => ({ com: acc.com + nCom(b.comSite), sem: acc.sem + nSem(b.semSite) }),
    { com: 0, sem: 0 }
  );
}

/** Mostra/esconde o grupo de colunas conforme a lista esteja marcada. */
function syncColGroups() {
  $("ex-cols-com-wrap").style.display = $("ex-com").checked ? "" : "none";
  $("ex-cols-sem-wrap").style.display = $("ex-sem").checked ? "" : "none";
}

function refreshExportCounts() {
  const { com, sem } = exportCounts();
  $("ex-com-n").textContent = com;
  $("ex-sem-n").textContent = sem;
}

async function openExportModal() {
  if (!state.id) return;
  await ensureExportCols();
  // Abrangência: só mostra "todas" quando há mais de uma busca.
  $("ex-combined").checked = false;
  $("ex-scope").disabled = false;
  $("ex-scope").value = state.buscas.length > 1 ? "all" : "current";
  refreshExportCounts();
  syncColGroups();
  $("ex-status").textContent = "";
  $("exportModal").style.display = "flex";
}

function closeExportModal() {
  $("exportModal").style.display = "none";
}

/** Coleta a configuração escolhida no modal. */
function exportConfig() {
  const lists = [];
  if ($("ex-com").checked) lists.push("com-site");
  if ($("ex-sem").checked) lists.push("sem-site");
  const formats = [];
  if ($("ex-xlsx").checked) formats.push("xlsx");
  if ($("ex-csv").checked) formats.push("csv");
  const pick = (id) =>
    [...document.querySelectorAll(`#${id} input:checked`)].map((i) => i.value);
  return {
    scope: $("ex-scope").value === "current" ? state.current : "all",
    lists,
    formats,
    reports: $("ex-reports").value,
    locale: $("ex-lang").value,
    onlyWithEmail: $("ex-only-email").checked,
    oneEmailPerRow: $("ex-one-email").checked,
    combined: $("ex-combined").checked,
    statuses: selectedStatuses(),
    columns: { "com-site": pick("ex-cols-com"), "sem-site": pick("ex-cols-sem") },
  };
}

async function runExport() {
  const cfg = exportConfig();
  if (!cfg.lists.length && cfg.reports === "none")
    return ($("ex-status").textContent = "Selecione ao menos uma lista ou os relatórios.");
  if (cfg.lists.length && !cfg.formats.length)
    return ($("ex-status").textContent = "Selecione ao menos um formato (XLSX ou CSV).");

  $("ex-go").disabled = true;
  $("ex-status").textContent =
    cfg.reports === "pdf" || cfg.reports === "both" ? "Gerando (PDF é mais lento)…" : "Gerando…";
  try {
    const res = await fetch(`/api/export/${state.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.message || `Erro ${res.status}`);
    }
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition") || "";
    const name = (cd.match(/filename="([^"]+)"/) || [])[1] || "leads-export.zip";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    closeExportModal();
  } catch (e) {
    $("ex-status").textContent = "❌ " + e.message;
  } finally {
    $("ex-go").disabled = false;
  }
}

function setupExportModal() {
  $("ex-com").addEventListener("change", syncColGroups);
  $("ex-sem").addEventListener("change", syncColGroups);
  $("ex-scope").addEventListener("change", refreshExportCounts);
  $("ex-only-email").addEventListener("change", refreshExportCounts);
  $("ex-status-group").addEventListener("change", refreshExportCounts);
  // "Planilha única" junta todas as buscas: a abrangência por busca não se aplica.
  $("ex-combined").addEventListener("change", (e) => {
    $("ex-scope").disabled = e.target.checked;
    if (e.target.checked) $("ex-scope").value = "all";
    refreshExportCounts();
  });
  $("ex-cancel").addEventListener("click", closeExportModal);
  $("ex-go").addEventListener("click", runExport);
  // Botão "marcar/desmarcar todas" de cada grupo de colunas.
  document.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const boxes = [...document.querySelectorAll(`#${btn.dataset.toggle} input`)];
      const allOn = boxes.every((b) => b.checked);
      boxes.forEach((b) => (b.checked = !allOn));
      if (btn.dataset.toggle === "ex-status-group") refreshExportCounts();
    });
  });
  // Fecha ao clicar fora do card.
  $("exportModal").addEventListener("click", (e) => {
    if (e.target === $("exportModal")) closeExportModal();
  });
}

// Modo de busca: mostra/esconde campos conforme a opção.
// No modo grade o "coleta detalhada" não se aplica (o endpoint JSON já traz os dados).
// Na textarea: modo normal aceita links ou termos; modos grade aceitam APENAS termos
// (a localização entra pelo campo dedicado, não pela textarea).
const GRID_PLACEHOLDER = "restaurantes\ndentistas\nacademia de ginástica";
const NORMAL_PLACEHOLDER = "restaurantes em São Carlos\ndentistas em Ribeirão Preto\nhttps://www.google.com/maps/search/petshops+em+campinas";

function syncMode() {
  const mode = $("mode").value;
  const isGrid = mode === "grid";
  const isCity = mode === "city";
  const isGrade = isGrid || isCity;

  $("gridOpts").style.display = isGrid ? "flex" : "none";
  $("cityOpts").style.display = isCity ? "flex" : "none";
  $("gridHint").style.display = "none";
  $("deep").disabled = isGrade;

  // Textarea: em modos grade só aceita palavras-chave, não URLs.
  $("inputLabel").textContent = isGrade
    ? "Termos de busca — um por linha (sem links; a localização fica abaixo)"
    : "Links do Google Maps ou termos de busca — um por linha";
  $("input").placeholder = isGrade ? GRID_PLACEHOLDER : NORMAL_PLACEHOLDER;
}
$("mode").addEventListener("change", syncMode);
syncMode();

$("go").addEventListener("click", start);
$("enrich").addEventListener("click", enrich);
$("sitetext").addEventListener("click", sitetext);
$("emailScrape").addEventListener("click", emailScrape);
$("socialScrape").addEventListener("click", socialScrape);
$("exportZip").addEventListener("click", openExportModal);
$("buscaSel").addEventListener("change", (e) => {
  state.current = parseInt(e.target.value, 10) || 0;
  renderCurrent();
});
setupTabs();
setupDownloads();
setupExportModal();
