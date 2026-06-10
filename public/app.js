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
  ["site", "Site", "link"], ["redes_sociais", "Redes", "links"],
  ["site_emails", "E-mails", "emails"],
  ["cwv_score", "Perf."], ["cwv_status", "Status", "cwv"],
  ["cwv_report", "Relatório", "report"],
  ["descricao", "Descrição"], ["link_maps", "Maps", "link"],
];
const COLS_SEM = [
  ["nome", "Nome"], ["categoria", "Categoria"], ["nota", "Nota"],
  ["avaliacoes", "Avaliações"], ["telefone", "Telefone"], ["whatsapp", "WhatsApp", "link"],
  ["redes_sociais", "Redes", "links"], ["descricao", "Descrição"], ["link_maps", "Maps", "link"],
];

// Estado da execução atual.
const state = { id: null, buscas: [], current: 0 };
let scrapeES = null;
let jobES = null; // SSE de enrich/sitetext (compartilham a barra)

// Botões de job (compartilham a barra de progresso de enriquecimento).
const JOB_BTNS = ["enrich", "sitetext", "emailScrape"];
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
  if (type === "links")
    return String(v)
      .split(" | ")
      .filter(Boolean)
      .map((u) => `<a href="${u}" target="_blank" rel="noopener">${hostOf(u)}</a>`)
      .join("<br>");
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

function renderSummary(stats) {
  const items = [
    ["Coletados", stats.bruto],
    ["Após limpeza", stats.limpos],
    ["Após filtro", stats.filtrados],
    ["Com site", stats.comSite],
    ["Sem site", stats.semSite],
  ];
  $("summary").innerHTML = items
    .map(([label, n]) => `<div class="stat"><b>${n}</b><span>${label}</span></div>`)
    .join("");
  $("countCom").textContent = stats.comSite;
  $("countSem").textContent = stats.semSite;
}

/** Renderiza a busca atualmente selecionada. */
function renderCurrent() {
  const b = state.buscas[state.current];
  if (!b) return;
  renderSummary(b.stats);
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
  if (!input) return setStatus("Informe ao menos um link ou termo de busca.");
  if (scrapeES) scrapeES.close();

  $("go").disabled = true;
  $("resultsCard").style.display = "none";
  setStatus("Iniciando...");
  setBar("bar", "barfill", 2);

  const params = new URLSearchParams({
    input,
    max: parseInt($("max").value, 10) || 0,
    deep: $("deep").checked ? "1" : "0",
    minAval: $("minAval").value,
    maxAval: $("maxAval").value,
    notaMin: $("notaMin").value,
  });
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
    const totalFiltrados = d.buscas.reduce((s, b) => s + b.stats.filtrados, 0);
    setStatus(`Concluído: ${d.buscas.length} busca(s), ${totalFiltrados} leads após o filtro.`);

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
    // Atualiza o comSite de cada busca com os dados enriquecidos.
    if (Array.isArray(d.comSitePerBusca))
      d.comSitePerBusca.forEach((cs, i) => { if (state.buscas[i]) state.buscas[i].comSite = cs; });
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
  const params = new URLSearchParams({
    key: $("key").value.trim(),
    conc: parseInt($("conc").value, 10) || 8,
  });
  runJob(`/api/enrich/${state.id}?${params}`, {
    startMsg: "Analisando sites no PageSpeed...",
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
        `<label class="check"><input type="checkbox" value="${c.key}" checked /> ${c.header}</label>`
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

/** Soma de leads por lista, conforme a abrangência escolhida. */
function exportCounts() {
  const buscas = $("ex-scope").value === "current" ? [state.buscas[state.current]] : state.buscas;
  return buscas.filter(Boolean).reduce(
    (acc, b) => ({ com: acc.com + b.comSite.length, sem: acc.sem + b.semSite.length }),
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
  $("ex-cancel").addEventListener("click", closeExportModal);
  $("ex-go").addEventListener("click", runExport);
  // Botão "marcar/desmarcar todas" de cada grupo de colunas.
  document.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const boxes = [...document.querySelectorAll(`#${btn.dataset.toggle} input`)];
      const allOn = boxes.every((b) => b.checked);
      boxes.forEach((b) => (b.checked = !allOn));
    });
  });
  // Fecha ao clicar fora do card.
  $("exportModal").addEventListener("click", (e) => {
    if (e.target === $("exportModal")) closeExportModal();
  });
}

$("go").addEventListener("click", start);
$("enrich").addEventListener("click", enrich);
$("sitetext").addEventListener("click", sitetext);
$("emailScrape").addEventListener("click", emailScrape);
$("exportZip").addEventListener("click", openExportModal);
$("buscaSel").addEventListener("change", (e) => {
  state.current = parseInt(e.target.value, 10) || 0;
  renderCurrent();
});
setupTabs();
setupDownloads();
setupExportModal();
