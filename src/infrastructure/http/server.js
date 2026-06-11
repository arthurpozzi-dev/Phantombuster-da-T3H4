/**
 * Camada de apresentação/HTTP: Express + Server-Sent Events (SSE).
 *
 * Expõe o pipeline na web e serve o front-end. Recebe os adaptadores por
 * injeção (composition root em src/main.js).
 *
 * Suporta VÁRIAS buscas de uma vez (um link/termo por linha no input). O estado
 * de uma execução fica no store como uma lista de buscas:
 *   id -> { ts, buscas: [ { query, comSite, semSite, stats } ] }
 *
 * Rotas:
 *   GET /api/scrape                         (SSE)  -> coleta + pipeline de N buscas
 *   GET /api/enrich/:id                     (SSE)  -> Core Web Vitals (todas as buscas)
 *   GET /api/sitetext/:id                   (SSE)  -> texto dos sites (todas as buscas)
 *   GET /api/emails/:id                     (SSE)  -> scraping completo de e-mails (todas as buscas)
 *   GET /api/report/:id/lead/:b/:i.html            -> relatório persuasivo de 1 lead
 *   GET /api/export/:id.zip                         -> pacote (pasta por busca)
 *   GET /api/download/:id/:b/:list.:ext             -> CSV/XLSX de uma lista de uma busca
 */
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { runPipeline } from "../../application/runPipeline.js";
import { enrichLeads } from "../../application/EnrichLeads.js";
import { scrapeSiteTexts } from "../../application/scrapeSiteTexts.js";
import { enrichEmails } from "../../application/enrichEmails.js";
import { PageSpeedClient } from "../pagespeed/PageSpeedClient.js";
import { toCSV } from "../export/csvExporter.js";
import { toXLSX } from "../export/xlsxExporter.js";
import { columnsFor } from "../export/columns.js";
import { slugify } from "../export/slug.js";
import { SUPPORTED_LOCALES, DEFAULT_LOCALE } from "../../application/reportI18n/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "../../../public");

/** Helper p/ enviar um evento SSE. */
function sseSender(res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  return (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
}

/** Divide o input em vários links/termos (um por linha). */
function parseInputs(raw) {
  return (raw || "")
    .toString()
    .split(/[\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Soma de leads "com site" em todas as buscas. */
const totalComSite = (buscas) => buscas.reduce((s, b) => s + b.comSite.length, 0);

/**
 * Cria a aplicação Express.
 * @param {Object} deps
 * @param {import("../scraper/GoogleMapsScraper.js").GoogleMapsScraper} deps.scraper
 * @param {import("../scraper/SiteTextScraper.js").SiteTextScraper} deps.siteTextScraper
 * @param {import("../scraper/EmailScraper.js").EmailScraper} deps.emailScraper
 * @param {() => import("../scraper/BrowserEmailScraper.js").BrowserEmailScraper} [deps.makeBrowserEmailScraper] fábrica (1 instância por requisição)
 * @param {() => import("../report/PdfRenderer.js").PdfRenderer} [deps.makePdfRenderer] fábrica de PDF (1 por requisição)
 * @param {import("../report/AuditReportRenderer.js").AuditReportRenderer} deps.reportRenderer
 * @param {import("../export/ExportBundle.js").ExportBundle} deps.exportBundle
 * @param {import("../scraper/SiteHealthChecker.js").SiteHealthChecker} deps.siteHealthChecker
 * @returns {import("express").Express}
 */
export function createServer({ scraper, siteTextScraper, emailScraper, makeBrowserEmailScraper, makePdfRenderer, reportRenderer, exportBundle, siteHealthChecker }) {
  const app = express();
  app.use(express.json());
  app.use(express.static(PUBLIC_DIR));

  const store = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [id, v] of store) if (now - v.ts > 3600_000) store.delete(id);
  }, 600_000).unref();

  // ---- Coleta + pipeline (N buscas) -------------------------------------
  app.get("/api/scrape", async (req, res) => {
    const send = sseSender(res);
    const inputs = parseInputs(req.query.input);
    const maxResults = parseInt(req.query.max, 10) || 0;
    const deep = req.query.deep !== "0";
    const filterOptions = {
      minAvaliacoes: parseFloat(req.query.minAval),
      maxAvaliacoes: parseFloat(req.query.maxAval),
      notaMin: parseFloat(req.query.notaMin),
    };
    for (const k of Object.keys(filterOptions))
      if (!Number.isFinite(filterOptions[k])) delete filterOptions[k];

    if (!inputs.length) {
      send("error", { message: "Informe ao menos um link ou termo de busca." });
      return res.end();
    }

    const buscas = [];
    try {
      for (let i = 0; i < inputs.length; i++) {
        const query = inputs[i];
        send("progress", {
          busca: i + 1,
          totalBuscas: inputs.length,
          query,
          message: `Busca ${i + 1}/${inputs.length}: ${query}`,
        });
        try {
          const raw = await scraper.scrape({
            input: query,
            maxResults,
            deep,
            onProgress: (p) => send("progress", { ...p, busca: i + 1, totalBuscas: inputs.length, query }),
          });
          const { comSite, semSite, stats } = runPipeline(raw, filterOptions);
          buscas.push({ query, comSite, semSite, stats });
        } catch (e) {
          // Uma busca que falha não derruba as outras.
          send("progress", { busca: i + 1, totalBuscas: inputs.length, query, message: `Falha em "${query}": ${e.message}` });
          buscas.push({ query, comSite: [], semSite: [], stats: { bruto: 0, limpos: 0, filtrados: 0, comSite: 0, semSite: 0, erro: e.message } });
        }
      }

      const id = randomUUID();
      store.set(id, { ts: Date.now(), buscas });
      send("done", { id, buscas });
    } catch (err) {
      send("error", { message: err.message || "Falha ao coletar." });
    } finally {
      res.end();
    }
  });

  // ---- Enriquecimento (Core Web Vitals) em todas as buscas --------------
  app.get("/api/enrich/:id", async (req, res) => {
    const send = sseSender(res);
    const item = store.get(req.params.id);
    if (!item) {
      send("error", { message: "Resultado expirado. Faça uma nova busca." });
      return res.end();
    }
    const apiKey = (req.query.key || "").toString().trim();
    const client = new PageSpeedClient({ apiKey });
    const concurrency =
      parseInt(req.query.conc, 10) || parseInt(process.env.ENRICH_CONCURRENCY, 10) || 8;

    const total = totalComSite(item.buscas);
    let done = 0;
    let ok = 0;
    let falhas = 0;
    let foraDoAr = 0;
    try {
      for (const b of item.buscas) {
        const r = await enrichLeads(
          b.comSite,
          client,
          (p) => {
            if (p.erro) console.warn(`[enrich] ${p.status} "${p.nome}": ${p.erro}`);
            send("progress", { current: ++done, total, nome: p.nome, status: p.status, query: b.query });
          },
          { concurrency, healthChecker: siteHealthChecker }
        );
        b.comSite = r.leads;
        ok += r.ok;
        falhas += r.falhas;
        foraDoAr += r.foraDoAr;
      }
      item.ts = Date.now();
      send("done", { ok, falhas, foraDoAr, comSitePerBusca: item.buscas.map((b) => b.comSite) });
    } catch (err) {
      send("error", { message: err.message || "Falha no enriquecimento." });
    } finally {
      res.end();
    }
  });

  // ---- Texto dos sites em todas as buscas -------------------------------
  app.get("/api/sitetext/:id", async (req, res) => {
    const send = sseSender(res);
    const item = store.get(req.params.id);
    if (!item) {
      send("error", { message: "Resultado expirado. Faça uma nova busca." });
      return res.end();
    }
    const concurrency =
      parseInt(req.query.conc, 10) || parseInt(process.env.SITETEXT_CONCURRENCY, 10) || 8;

    const total = totalComSite(item.buscas);
    let done = 0;
    let ok = 0;
    let falhas = 0;
    try {
      for (const b of item.buscas) {
        const r = await scrapeSiteTexts(
          b.comSite,
          siteTextScraper,
          (p) => send("progress", { current: ++done, total, nome: p.nome, erro: p.erro, query: b.query }),
          { concurrency }
        );
        b.comSite = r.leads;
        ok += r.ok;
        falhas += r.falhas;
      }
      item.ts = Date.now();
      send("done", { ok, falhas, comSitePerBusca: item.buscas.map((b) => b.comSite) });
    } catch (err) {
      send("error", { message: err.message || "Falha ao puxar o texto dos sites." });
    } finally {
      res.end();
    }
  });

  // ---- Scraping completo de e-mails em todas as buscas ------------------
  app.get("/api/emails/:id", async (req, res) => {
    const send = sseSender(res);
    const item = store.get(req.params.id);
    if (!item) {
      send("error", { message: "Resultado expirado. Faça uma nova busca." });
      return res.end();
    }
    const concurrency =
      parseInt(req.query.conc, 10) || parseInt(process.env.EMAIL_CONCURRENCY, 10) || 6;
    // Fallback com navegador (sites JS): ligado por padrão, desligável com render=0.
    const useBrowser = req.query.render !== "0" && typeof makeBrowserEmailScraper === "function";
    const browserScraper = useBrowser ? makeBrowserEmailScraper() : null;
    const browserConcurrency =
      parseInt(req.query.bconc, 10) || parseInt(process.env.EMAIL_BROWSER_CONCURRENCY, 10) || 2;

    let ok = 0;
    let semEmail = 0;
    let falhas = 0;
    let renderizados = 0;
    // Progresso por fase: cada fase reporta seu próprio current/total (a barra reinicia).
    const sendProgress = (p, query) =>
      send("progress", { fase: p.fase, current: p.current, total: p.total, nome: p.nome, encontrados: p.encontrados, query });
    try {
      for (const b of item.buscas) {
        const r = await enrichEmails(
          b.comSite,
          emailScraper,
          (p) => {
            if (p.erro) console.warn(`[emails] "${p.nome}": ${p.erro}`);
            sendProgress(p, b.query);
          },
          { concurrency, browserScraper, browserConcurrency }
        );
        b.comSite = r.leads;
        ok += r.ok;
        semEmail += r.semEmail;
        falhas += r.falhas;
        renderizados += r.renderizados;
      }
      item.ts = Date.now();
      send("done", { ok, semEmail, falhas, renderizados, comSitePerBusca: item.buscas.map((b) => b.comSite) });
    } catch (err) {
      send("error", { message: err.message || "Falha ao buscar e-mails." });
    } finally {
      await browserScraper?.close();
      res.end();
    }
  });

  // ---- Relatório persuasivo de 1 lead (busca b, índice i) ---------------
  app.get("/api/report/:id/lead/:b/:i.html", (req, res) => {
    const item = store.get(req.params.id);
    if (!item) return res.status(404).send("Resultado expirado. Faça uma nova busca.");
    const busca = item.buscas[parseInt(req.params.b, 10)];
    const lead = busca?.comSite[parseInt(req.params.i, 10)];
    if (!lead) return res.status(404).send("Lead não encontrado.");
    if (!lead.cwv_report)
      return res.status(409).send("Enriqueça os sites (Core Web Vitals) antes de gerar o relatório.");
    const locale = SUPPORTED_LOCALES.includes(req.query.lang) ? req.query.lang : DEFAULT_LOCALE;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(reportRenderer.render(lead, { locale }));
  });

  // ---- Colunas disponíveis por lista (para a tela de exportação) --------
  app.get("/api/columns", (req, res) => {
    res.json({ "com-site": columnsFor("com-site"), "sem-site": columnsFor("sem-site") });
  });

  // ---- Exportação configurável (.zip): listas/formatos/colunas/relatórios -
  app.post("/api/export/:id", async (req, res) => {
    const item = store.get(req.params.id);
    if (!item) return res.status(404).json({ message: "Resultado expirado. Faça uma nova busca." });

    const cfg = req.body || {};
    const lists = (Array.isArray(cfg.lists) ? cfg.lists : []).filter(
      (l) => l === "com-site" || l === "sem-site"
    );
    const formats = (Array.isArray(cfg.formats) ? cfg.formats : []).filter(
      (f) => f === "csv" || f === "xlsx"
    );
    const reports = ["none", "html", "pdf", "both"].includes(cfg.reports) ? cfg.reports : "none";
    const locale = SUPPORTED_LOCALES.includes(cfg.locale) ? cfg.locale : DEFAULT_LOCALE;
    const onlyWithEmail = cfg.onlyWithEmail === true;
    const columns =
      cfg.columns && typeof cfg.columns === "object" && !Array.isArray(cfg.columns) ? cfg.columns : null;

    // Abrangência: todas as buscas (padrão) ou só uma (índice).
    const buscas =
      cfg.scope === "all" || cfg.scope == null
        ? item.buscas
        : [item.buscas[parseInt(cfg.scope, 10)]].filter(Boolean);

    if (!buscas.length) return res.status(400).json({ message: "Nenhuma busca selecionada." });
    if (!lists.length && reports === "none")
      return res.status(400).json({ message: "Selecione ao menos uma lista ou os relatórios." });
    if (lists.length && !formats.length)
      return res.status(400).json({ message: "Selecione ao menos um formato (CSV ou XLSX)." });

    const needsPdf = (reports === "pdf" || reports === "both") && typeof makePdfRenderer === "function";
    const pdfRenderer = needsPdf ? makePdfRenderer() : null;
    try {
      const { buffer } = await exportBundle.build(buscas, { lists, formats, columns, reports, pdfRenderer, locale, onlyWithEmail });
      const base = buscas.length === 1 ? slugify(buscas[0].query, "leads") : "leads";
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${base}-export.zip"`);
      res.send(buffer);
    } catch (err) {
      res.status(500).json({ message: err.message || "Falha ao exportar." });
    } finally {
      await pdfRenderer?.close();
    }
  });

  // ---- Pacote completo (.zip): pasta por busca (padrão; compatibilidade) -
  app.get("/api/export/:id.zip", async (req, res) => {
    const item = store.get(req.params.id);
    if (!item) return res.status(404).send("Resultado expirado. Faça uma nova busca.");
    const { buffer } = await exportBundle.build(item.buscas);
    const base = item.buscas.length === 1 ? slugify(item.buscas[0].query, "leads") : "leads";
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${base}-export.zip"`);
    res.send(buffer);
  });

  // ---- Download avulso de uma lista de uma busca ------------------------
  app.get("/api/download/:id/:b/:list.:ext", async (req, res) => {
    const { id, b, list, ext } = req.params;
    const item = store.get(id);
    if (!item) return res.status(404).send("Resultado expirado. Faça uma nova busca.");
    const busca = item.buscas[parseInt(b, 10)];
    if (!busca) return res.status(404).send("Busca não encontrada.");
    if (list !== "com-site" && list !== "sem-site")
      return res.status(400).send("Lista inválida.");

    const rows = list === "com-site" ? busca.comSite : busca.semSite;
    const columns = columnsFor(list);
    const filename = `${slugify(busca.query, "leads")}-${list}`;

    if (ext === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
      return res.send(toCSV(rows, columns));
    }
    if (ext === "xlsx") {
      const buffer = await toXLSX(rows, columns, list === "com-site" ? "Com site" : "Sem site");
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
      return res.send(Buffer.from(buffer));
    }
    return res.status(400).send("Formato inválido.");
  });

  return app;
}
