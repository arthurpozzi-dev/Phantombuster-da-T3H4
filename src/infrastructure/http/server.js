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
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { runPipeline } from "../../application/runPipeline.js";
import { dedupeAcrossBuscas } from "../../application/dedupeAcrossBuscas.js";
import { enrichLeads } from "../../application/EnrichLeads.js";
import { createJobCache, createCwvCache } from "../../application/jobCache.js";
import { scrapeSiteTexts } from "../../application/scrapeSiteTexts.js";
import { enrichEmails } from "../../application/enrichEmails.js";
import { enrichSocials } from "../../application/enrichSocials.js";
import { PageSpeedClient } from "../pagespeed/PageSpeedClient.js";
import { buildEnrichClients } from "./enrichClients.js";
import { ensureFullReport } from "../../application/ensureFullReport.js";
import { SiteTextScraper } from "../scraper/SiteTextScraper.js";
import { EmailScraper } from "../scraper/EmailScraper.js";
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

/**
 * Extrai o centro (lat, lng) da busca por grade. Aceita:
 *   - "lat,lng"  (ex.: "-22.0175,-47.8908")
 *   - um link do Maps com "@lat,lng" (ex.: ".../@-22.01,-47.89,13z")
 * @param {string} raw
 * @returns {{lat:number,lng:number} | null}
 */
function parseCenter(raw) {
  const str = (raw || "").toString().trim();
  if (!str) return null;
  const at = str.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (at) return { lat: parseFloat(at[1]), lng: parseFloat(at[2]) };
  const pair = str.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (pair) return { lat: parseFloat(pair[1]), lng: parseFloat(pair[2]) };
  return null;
}

/**
 * Geocodifica um nome de cidade usando a API pública do Nominatim (OpenStreetMap).
 * Sem chave de API; retorna {lat, lng} ou lança em caso de falha/não encontrado.
 * @param {string} cityName
 * @returns {Promise<{lat:number, lng:number}>}
 */
async function geocodeCity(cityName) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cityName)}&format=json&limit=1`;
  let data;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "MapsLeadsScraper/1.0 (contact@t3h4.studios)" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (e) {
    throw new Error(`Falha ao geocodificar "${cityName}": ${e.message}`);
  }
  if (!Array.isArray(data) || !data[0])
    throw new Error(`Cidade não encontrada: "${cityName}". Tente incluir o estado ou país (ex.: "Campinas, SP, Brasil").`);
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
}

/** Soma de leads "com site" em todas as buscas. */
const totalComSite = (buscas) => buscas.reduce((s, b) => s + b.comSite.length, 0);

/**
 * Cria a aplicação Express.
 * @param {Object} deps
 * @param {import("../scraper/GoogleMapsScraper.js").GoogleMapsScraper} deps.scraper  coleta normal (navegador)
 * @param {import("../scraper/GoogleMapsGridScraper.js").GoogleMapsGridScraper} [deps.gridScraper]  coleta por grade (sem limite de ~120)
 * @param {import("../scraper/SiteTextScraper.js").SiteTextScraper} deps.siteTextScraper
 * @param {import("../scraper/EmailScraper.js").EmailScraper} deps.emailScraper
 * @param {() => import("../scraper/BrowserEmailScraper.js").BrowserEmailScraper} [deps.makeBrowserEmailScraper] fábrica (1 instância por requisição)
 * @param {() => import("../report/PdfRenderer.js").PdfRenderer} [deps.makePdfRenderer] fábrica de PDF (1 por requisição)
 * @param {import("../report/AuditReportRenderer.js").AuditReportRenderer} deps.reportRenderer
 * @param {import("../export/ExportBundle.js").ExportBundle} deps.exportBundle
 * @param {import("../scraper/SiteHealthChecker.js").SiteHealthChecker} deps.siteHealthChecker
 * @param {import("../scraper/SocialSearchScraper.js").SocialSearchScraper} [deps.socialSearchScraper] descoberta de redes por busca web (opt-in)
 * @returns {import("express").Express}
 */
/** Instâncias externas configuradas via env (LIGHTHOUSE_SERVER_URL), separadas por vírgula. */
function externalLighthouseUrls() {
  return (process.env.LIGHTHOUSE_SERVER_URL || "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
}

/**
 * Resolve a URL (ou lista, vírgula) da análise Lighthouse a partir da escolha da
 * UI (`lhSource`). Pode subir a frota gerenciada, por isso é assíncrona.
 *  - "google" -> "" (força o PageSpeed do Google)
 *  - "custom" -> a URL informada no campo da interface (lighthouseUrl)
 *  - "system" -> instâncias externas da env, se houver; senão a FROTA GERENCIADA:
 *               sobe N workers (lhInstances do front) e devolve as URLs deles.
 * Sem `lhSource` (chamadas legadas): lighthouseUrl da query, com fallback para a env.
 */
async function resolveLighthouse(req, fleet) {
  const source = (req.query.lhSource || "").toString().trim();
  if (source === "google") return "";
  if (source === "custom") return (req.query.lighthouseUrl || "").toString().trim();
  if (source === "system") {
    const external = externalLighthouseUrls();
    if (external.length) return external.join(","); // frota externa tem precedência
    if (fleet) return (await fleet.ensure(req.query.lhInstances)).join(",");
    return "";
  }
  return (req.query.lighthouseUrl || process.env.LIGHTHOUSE_SERVER_URL || "").toString().trim();
}

export function createServer({ scraper, gridScraper, siteTextScraper, emailScraper, makeBrowserEmailScraper, makePdfRenderer, reportRenderer, exportBundle, siteHealthChecker, socialSearchScraper, engines, lighthouseFleet }) {
  /** Resolve o engine de scraping a partir dos parâmetros da requisição. */
  const resolveEngine = (req) =>
    engines
      ? engines.get(req.query.engine || "playwright", { mode: req.query.scraplingMode || "fast" })
      : { name: "playwright", supportsBrowser: true };
  const app = express();
  app.use(express.json());
  app.use(express.static(PUBLIC_DIR));

  const store = new Map();
  // TTL de jobs OCIOSOS (sem nenhuma fase em andamento). Configurável via env.
  const RESULT_TTL_MS = (parseInt(process.env.RESULT_TTL_MIN, 10) || 60) * 60_000;
  /** Cache/dedup do job (criado sob demanda; some com o job). */
  const cacheFor = (item) => (item.cache ||= createJobCache());
  /**
   * Marca um job como EM USO enquanto uma fase o processa, renovando o relógio do
   * TTL. Sem isso, uma fase longa (ex.: scraping de e-mail de milhares de leads,
   * que passa de 1h) era varrida pelo coletor NO MEIO do caminho, e a requisição
   * seguinte via "Resultado expirado". Pareie SEMPRE com `releaseJob` no finally.
   */
  const holdJob = (item) => {
    item.active = (item.active || 0) + 1;
    item.ts = Date.now();
  };
  const releaseJob = (item) => {
    if (item.active) item.active--;
    item.ts = Date.now(); // reinicia o TTL de ociosidade a partir do fim da fase
  };
  // Timeout por requisição HTTP do scraper de e-mail. Default subiu de 10s → 20s:
  // muitos sites de negócio (hospedagem lenta, home pesada) não respondiam em 10s
  // e caíam como falha, empurrando o lead para as fases caras (engine/navegador).
  const EMAIL_TIMEOUT_MS = parseInt(process.env.EMAIL_TIMEOUT_MS, 10) || 20000;
  /**
   * Cache de CWV PERSISTENTE entre jobs (por domínio + modo), com TTL. Reanalisar
   * o mesmo domínio em re-runs/buscas repetidas é o desperdício mais caro do
   * enriquecimento — aqui ele vira leitura instantânea. TTL configurável via env.
   */
  const cwvStore = createCwvCache({
    ttlMs: (parseInt(process.env.CWV_CACHE_TTL_MIN, 10) || 360) * 60_000,
  });
  setInterval(() => {
    const now = Date.now();
    // Só evicta jobs OCIOSOS: um job com fase em andamento (active>0) nunca é
    // varrido no meio, por mais longa que a fase seja.
    for (const [id, v] of store) if (!v.active && now - v.ts > RESULT_TTL_MS) store.delete(id);
    cwvStore.sweep(); // evicta entradas de CWV expiradas (domínios nunca relidos)
  }, 600_000).unref();

  // ---- Config da UI (capacidades do servidor) ---------------------------
  app.get("/api/config", (_req, res) => {
    const external = externalLighthouseUrls().length;
    res.json({
      // Instâncias externas fixas (LIGHTHOUSE_SERVER_URL). Quando > 0, têm precedência.
      lighthouseExternal: external,
      // App sobe a frota sob demanda (só quando não há instâncias externas).
      lighthouseManaged: external === 0 && !!lighthouseFleet,
      // Teto de instâncias que o front pode pedir na frota gerenciada.
      lighthouseMaxInstances: lighthouseFleet?.maxInstances || 0,
    });
  });

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

    // Modo de busca: "normal" (navegador), "grid" (grade por coordenadas) ou "city" (grade por nome).
    const mode = req.query.mode || "normal";
    const isGrid = mode === "grid";
    const isCity = mode === "city";
    const isGrade = isGrid || isCity;
    const areaSize = parseFloat(req.query.area) || 0.05;
    const step = parseFloat(req.query.step) || 0.04;

    if (!inputs.length) {
      send("error", { message: "Informe ao menos um link ou termo de busca." });
      return res.end();
    }
    if (isGrade && !gridScraper) {
      send("error", { message: "Busca por grade indisponível no servidor." });
      return res.end();
    }
    if (isGrid && !parseCenter(req.query.center)) {
      send("error", { message: "No modo grade, informe o centro (lat,lng ou um link do Maps com @lat,lng)." });
      return res.end();
    }
    if (isCity && !req.query.city?.trim()) {
      send("error", { message: "No modo cidade, informe o nome da cidade." });
      return res.end();
    }

    // Geocodifica o centro UMA vez para todas as buscas (no modo cidade).
    let cityCenter = null;
    if (isCity) {
      try {
        send("progress", { message: `Geocodificando "${req.query.city}"…` });
        cityCenter = await geocodeCity(req.query.city.trim());
        send("progress", { message: `Cidade encontrada: ${cityCenter.lat.toFixed(4)}, ${cityCenter.lng.toFixed(4)}` });
      } catch (e) {
        send("error", { message: e.message });
        return res.end();
      }
    }
    const gridCenter = isGrid ? parseCenter(req.query.center) : cityCenter;

    // Engine selecionado. O deep-scrape interativo do Maps exige browser ao vivo;
    // se o engine escolhido não fornece (Scrapling), degrada para Playwright na
    // coleta e avisa — o engine escolhido segue valendo no enriquecimento.
    const reqEngine = resolveEngine(req);
    let scrapeEngine = reqEngine;
    if (!isGrade && reqEngine && reqEngine.supportsBrowser === false) {
      scrapeEngine = engines ? engines.get("playwright") : { name: "playwright", supportsBrowser: true };
      send("progress", {
        message: `Engine "${reqEngine.name}" não faz o scroll interativo do Maps — usando Playwright na coleta (o engine escolhido vale no enriquecimento).`,
      });
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
          const onProgress = (p) => send("progress", { ...p, busca: i + 1, totalBuscas: inputs.length, query });
          const raw = isGrade
            ? await gridScraper.scrape({ keyword: query, center: gridCenter, areaSize, step, maxResults, onProgress })
            : await scraper.scrape({ input: query, maxResults, deep, onProgress, engine: scrapeEngine });
          const { comSite, semSite, stats } = runPipeline(raw, filterOptions);
          buscas.push({ query, comSite, semSite, stats });
        } catch (e) {
          // Uma busca que falha não derruba as outras.
          send("progress", { busca: i + 1, totalBuscas: inputs.length, query, message: `Falha em "${query}": ${e.message}` });
          buscas.push({ query, comSite: [], semSite: [], stats: { bruto: 0, limpos: 0, filtrados: 0, comSite: 0, semSite: 0, erro: e.message } });
        }
      }

      // Remove duplicatas ENTRE as buscas (mesmo lugar em pesquisas diferentes)
      // antes de armazenar — assim o enriquecimento, os e-mails e a planilha
      // final já trabalham sem repetições.
      const { removed } = dedupeAcrossBuscas(buscas);
      if (removed) send("progress", { message: `${removed} duplicata(s) entre buscas removida(s).` });

      const id = randomUUID();
      store.set(id, { ts: Date.now(), buscas });
      send("done", { id, buscas, duplicatasRemovidas: removed });
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
    let lighthouseUrl;
    try {
      lighthouseUrl = await resolveLighthouse(req, lighthouseFleet);
    } catch (e) {
      send("error", { message: "Não foi possível subir a frota Lighthouse: " + (e?.message || "falha") + "." });
      return res.end();
    }
    if ((req.query.lhSource || "").toString().trim() === "custom" && !lighthouseUrl) {
      send("error", { message: "Informe a URL da instância Lighthouse (ou troque a fonte da análise)." });
      return res.end();
    }
    const deep = req.query.deep === "1";
    const { pageSpeed: client, crux } = buildEnrichClients({ apiKey, deep, lighthouseUrl });
    // Concorrência conforme ONDE o laboratório roda:
    //  - API do Google (lighthouseUrl vazio): o trabalho é offloaded, então o
    //    nosso lado é só I/O de rede — paraleliza alto (ENRICH_CONCURRENCY, ~24).
    //  - Self-hosted/custom: cada run é Lighthouse CPU-bound NA NOSSA máquina;
    //    passar de ~metade dos núcleos só gera contenção e timeout (vira N/A).
    //    Capa em floor(núcleos/2) E no nº de workers (evita fila de 1 no worker).
    const labUrls = (lighthouseUrl || "").split(",").map((u) => u.trim()).filter(Boolean);
    const requested = parseInt(req.query.conc, 10) || 0; // 0 = automático (campo "auto")
    let concurrency;
    if (labUrls.length) {
      // Self-hosted: default floor(núcleos/2). E NUNCA mais que o nº de workers —
      // mesmo com valor explícito —, pois acima disso só enfileira no worker e
      // estoura o timeout (vira N/A).
      const base = requested || parseInt(process.env.ENRICH_CONCURRENCY_LOCAL, 10) || Math.max(1, Math.floor(os.cpus().length / 2));
      concurrency = Math.min(base, labUrls.length);
    } else {
      // API do Google: default 24, com clamp de segurança em 50 para não martelar
      // a cota por acidente (mesmo se alguém forçar um valor enorme).
      concurrency = Math.min(requested || parseInt(process.env.ENRICH_CONCURRENCY, 10) || 24, 50);
    }

    const total = totalComSite(item.buscas);
    let done = 0;
    let ok = 0;
    let falhas = 0;
    let foraDoAr = 0;
    holdJob(item);
    try {
      for (const b of item.buscas) {
        const r = await enrichLeads(
          b.comSite,
          client,
          (p) => {
            if (p.erro) console.warn(`[enrich] ${p.status} "${p.nome}": ${p.erro}`);
            send("progress", { current: ++done, total, nome: p.nome, status: p.status, query: b.query });
          },
          { concurrency, cruxClient: crux, deep, cwvCache: cwvStore }
        );
        b.comSite = r.leads;
        ok += r.ok;
        falhas += r.falhas;
        foraDoAr += r.foraDoAr;
      }
      send("done", { ok, falhas, foraDoAr, comSitePerBusca: item.buscas.map((b) => b.comSite) });
    } catch (err) {
      send("error", { message: err.message || "Falha no enriquecimento." });
    } finally {
      releaseJob(item);
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
    const engine = resolveEngine(req);
    const sts = engine.name === "playwright" ? siteTextScraper : new SiteTextScraper({ engine });

    const total = totalComSite(item.buscas);
    let done = 0;
    let ok = 0;
    let falhas = 0;
    holdJob(item);
    try {
      for (const b of item.buscas) {
        const r = await scrapeSiteTexts(
          b.comSite,
          sts,
          (p) => send("progress", { current: ++done, total, nome: p.nome, erro: p.erro, query: b.query }),
          { concurrency }
        );
        b.comSite = r.leads;
        ok += r.ok;
        falhas += r.falhas;
      }
      send("done", { ok, falhas, comSitePerBusca: item.buscas.map((b) => b.comSite) });
    } catch (err) {
      send("error", { message: err.message || "Falha ao puxar o texto dos sites." });
    } finally {
      releaseJob(item);
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
      parseInt(req.query.conc, 10) || parseInt(process.env.EMAIL_CONCURRENCY, 10) || 20;
    const engine = resolveEngine(req);
    // Cascata de 3 níveis (ver enrichEmails):
    //  1) fetch nativo SEMPRE (rápido/paralelo) — independente do engine escolhido;
    //  2) anti-ban: re-tenta os sites BLOQUEADOS via engine em HTTP (Scrapling fast),
    //     sem navegador — só quando o engine não é o Playwright;
    //  3) navegador: fallback para sites JS (Fase 2 abaixo).
    const es = emailScraper;
    const engineScraper =
      engine.name !== "playwright" ? new EmailScraper({ engine, engineMode: "fast", timeoutMs: EMAIL_TIMEOUT_MS }) : null;
    const engineConcurrency =
      parseInt(req.query.econc, 10) || parseInt(process.env.EMAIL_ENGINE_CONCURRENCY, 10) || 4;
    // Fallback com navegador (sites JS): ligado por padrão, desligável com render=0.
    // Usa o engine escolhido se ele fornece browser ao vivo (ex.: CloakBrowser anti-ban);
    // senão (Scrapling) cai no Playwright para o fallback.
    const useBrowser = req.query.render !== "0" && typeof makeBrowserEmailScraper === "function";
    const browserScraper = useBrowser
      ? makeBrowserEmailScraper(engine.supportsBrowser ? engine : undefined)
      : null;
    const browserConcurrency =
      parseInt(req.query.bconc, 10) || parseInt(process.env.EMAIL_BROWSER_CONCURRENCY, 10) || 2;
    const cache = cacheFor(item);

    let ok = 0;
    let semEmail = 0;
    let falhas = 0;
    let renderizados = 0;
    let antiBan = 0;
    // Progresso por fase: cada fase reporta seu próprio current/total (a barra reinicia).
    const sendProgress = (p, query) =>
      send("progress", { fase: p.fase, current: p.current, total: p.total, nome: p.nome, encontrados: p.encontrados, query });
    holdJob(item);
    try {
      for (const b of item.buscas) {
        const r = await enrichEmails(
          b.comSite,
          es,
          (p) => {
            if (p.erro) console.warn(`[emails] "${p.nome}": ${p.erro}`);
            sendProgress(p, b.query);
          },
          { concurrency, engineScraper, engineConcurrency, browserScraper, browserConcurrency, pageCache: cache.page }
        );
        b.comSite = r.leads;
        ok += r.ok;
        semEmail += r.semEmail;
        falhas += r.falhas;
        renderizados += r.renderizados;
        antiBan += r.antiBan;
      }
      send("done", { ok, semEmail, falhas, renderizados, antiBan, comSitePerBusca: item.buscas.map((b) => b.comSite) });
    } catch (err) {
      send("error", { message: err.message || "Falha ao buscar e-mails." });
    } finally {
      releaseJob(item);
      await browserScraper?.close();
      res.end();
    }
  });

  // ---- Descoberta de redes sociais em todas as buscas -------------------
  app.get("/api/socials/:id", async (req, res) => {
    const send = sseSender(res);
    const item = store.get(req.params.id);
    if (!item) {
      send("error", { message: "Resultado expirado. Faça uma nova busca." });
      return res.end();
    }
    const concurrency =
      parseInt(req.query.conc, 10) || parseInt(process.env.SOCIAL_CONCURRENCY, 10) || 20;
    const engine = resolveEngine(req);
    // Cascata de 3 níveis (ver enrichSocials): fetch nativo → anti-ban (engine
    // HTTP, só sites bloqueados) → navegador.
    const es = emailScraper;
    const engineScraper =
      engine.name !== "playwright" ? new EmailScraper({ engine, engineMode: "fast", timeoutMs: EMAIL_TIMEOUT_MS }) : null;
    const engineConcurrency =
      parseInt(req.query.econc, 10) || parseInt(process.env.EMAIL_ENGINE_CONCURRENCY, 10) || 4;
    // Fallback com navegador (sites JS): ligado por padrão, desligável com render=0.
    const useBrowser = req.query.render !== "0" && typeof makeBrowserEmailScraper === "function";
    const browserScraper = useBrowser
      ? makeBrowserEmailScraper(engine.supportsBrowser ? engine : undefined)
      : null;
    const browserConcurrency =
      parseInt(req.query.bconc, 10) || parseInt(process.env.EMAIL_BROWSER_CONCURRENCY, 10) || 2;
    // Busca web (descoberta para quem não tem rede): opt-in via search=1.
    const useSearch = req.query.search === "1" && !!socialSearchScraper;
    const cache = cacheFor(item);

    let ok = 0;
    let semRedes = 0;
    let falhas = 0;
    let viaBusca = 0;
    let antiBan = 0;
    const sendProgress = (p, query) =>
      send("progress", { fase: p.fase, current: p.current, total: p.total, nome: p.nome, encontrados: p.encontrados, query });
    holdJob(item);
    try {
      for (const b of item.buscas) {
        const r = await enrichSocials(
          { comSite: b.comSite, semSite: b.semSite },
          { emailScraper: es, engineScraper, browserScraper, socialSearchScraper: useSearch ? socialSearchScraper : null },
          (p) => {
            if (p.erro) console.warn(`[socials] "${p.nome}": ${p.erro}`);
            sendProgress(p, b.query);
          },
          { concurrency, engineConcurrency, browserConcurrency, pageCache: cache.page, searchCache: cache.search }
        );
        b.comSite = r.comSite;
        b.semSite = r.semSite;
        ok += r.ok;
        semRedes += r.semRedes;
        falhas += r.falhas;
        viaBusca += r.viaBusca;
        antiBan += r.antiBan;
      }
      send("done", {
        ok,
        semRedes,
        falhas,
        viaBusca,
        antiBan,
        comSitePerBusca: item.buscas.map((b) => b.comSite),
        semSitePerBusca: item.buscas.map((b) => b.semSite),
      });
    } catch (err) {
      send("error", { message: err.message || "Falha ao buscar redes sociais." });
    } finally {
      releaseJob(item);
      await browserScraper?.close();
      res.end();
    }
  });

  // ---- Relatório persuasivo de 1 lead (busca b, índice i) ---------------
  app.get("/api/report/:id/lead/:b/:i.html", async (req, res) => {
    const item = store.get(req.params.id);
    if (!item) return res.status(404).send("Resultado expirado. Faça uma nova busca.");
    const busca = item.buscas[parseInt(req.params.b, 10)];
    const lead = busca?.comSite[parseInt(req.params.i, 10)];
    if (!lead) return res.status(404).send("Lead não encontrado.");
    // Modo rápido (CrUX) deixa cwv_report null: gera o Lighthouse completo agora.
    if (!lead.cwv_report) {
      if (!lead.site)
        return res.status(409).send("Enriqueça os sites (Core Web Vitals) antes de gerar o relatório.");
      try {
        const apiKey = (req.query.key || "").toString().trim();
        const lighthouseUrl = await resolveLighthouse(req, lighthouseFleet);
        if ((req.query.lhSource || "").toString().trim() === "custom" && !lighthouseUrl) {
          return res.status(400).send("Informe a URL da instância Lighthouse (ou troque a fonte da análise).");
        }
        const { pageSpeed } = buildEnrichClients({ apiKey, deep: true, lighthouseUrl });
        await ensureFullReport(lead, pageSpeed, cacheFor(item).cwv);
      } catch (e) {
        return res
          .status(409)
          .send("Não foi possível analisar o site para o relatório: " + (e?.message || "falha") + ".");
      }
    }
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
    const oneEmailPerRow = cfg.oneEmailPerRow === true;
    const combined = cfg.combined === true;
    // Filtro por status de performance (lista "com site"). Aceita só os valores
    // conhecidos; lista completa ou vazia => sem filtro (null).
    const VALID_STATUSES = ["BOM", "MÉDIO", "RUIM", "FORA DO AR", "N/A"];
    const pickedStatuses = (Array.isArray(cfg.statuses) ? cfg.statuses : []).filter((s) =>
      VALID_STATUSES.includes(s)
    );
    const statuses =
      pickedStatuses.length && pickedStatuses.length < VALID_STATUSES.length
        ? pickedStatuses
        : null;
    const columns =
      cfg.columns && typeof cfg.columns === "object" && !Array.isArray(cfg.columns) ? cfg.columns : null;

    // Abrangência: o modo combinado sempre junta todas; senão, todas (padrão) ou
    // só uma (índice).
    const buscas =
      combined || cfg.scope === "all" || cfg.scope == null
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
      const { buffer } = await exportBundle.build(buscas, { lists, formats, columns, reports, pdfRenderer, locale, onlyWithEmail, combined, oneEmailPerRow, statuses });
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
