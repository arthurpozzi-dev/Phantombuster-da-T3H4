import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { scrapeMaps } from "./scraper.js";
import { toCSV, toXLSX } from "./export.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Guarda os resultados em memoria para download (id -> { rows, query, ts }).
const store = new Map();

// Limpa resultados com mais de 1 hora para nao vazar memoria.
setInterval(() => {
  const now = Date.now();
  for (const [id, v] of store) if (now - v.ts > 3600_000) store.delete(id);
}, 600_000).unref();

/**
 * Scraping com progresso ao vivo via Server-Sent Events (SSE).
 * GET /api/scrape?input=...&max=0&deep=1
 */
app.get("/api/scrape", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const input = (req.query.input || "").toString();
  const maxResults = parseInt(req.query.max, 10) || 0;
  const deep = req.query.deep !== "0";

  try {
    const rows = await scrapeMaps({
      input,
      maxResults,
      deep,
      headless: true,
      onProgress: (p) => send("progress", p),
    });

    const id = randomUUID();
    store.set(id, { rows, query: input, ts: Date.now() });
    send("done", { id, count: rows.length, rows });
  } catch (err) {
    send("error", { message: err.message || "Falha ao coletar." });
  } finally {
    res.end();
  }
});

function safeName(q) {
  return (q || "leads")
    .toString()
    .replace(/https?:\/\/\S+/g, "leads")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "leads";
}

app.get("/api/download/:id.csv", (req, res) => {
  const item = store.get(req.params.id);
  if (!item) return res.status(404).send("Resultado expirado. Faça uma nova busca.");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName(item.query)}.csv"`);
  res.send(toCSV(item.rows));
});

app.get("/api/download/:id.xlsx", async (req, res) => {
  const item = store.get(req.params.id);
  if (!item) return res.status(404).send("Resultado expirado. Faça uma nova busca.");
  const buffer = await toXLSX(item.rows);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName(item.query)}.xlsx"`);
  res.send(Buffer.from(buffer));
});

app.listen(PORT, () => {
  console.log(`\n  Maps Leads Scraper rodando em: http://localhost:${PORT}\n`);
});
