/**
 * Composition Root.
 *
 * É aqui — e só aqui — que as implementações concretas (adaptadores) são
 * criadas e ligadas (injeção de dependência), mantendo as demais camadas
 * desacopladas. Também carrega variáveis de ambiente do arquivo .env, se existir.
 */
import { GoogleMapsScraper } from "./infrastructure/scraper/GoogleMapsScraper.js";
import { SiteTextScraper } from "./infrastructure/scraper/SiteTextScraper.js";
import { AuditReportRenderer } from "./infrastructure/report/AuditReportRenderer.js";
import { ExportBundle } from "./infrastructure/export/ExportBundle.js";
import { createServer } from "./infrastructure/http/server.js";

// Carrega .env (PAGESPEED_API_KEY, PORT) usando o recurso nativo do Node 22+.
try {
  process.loadEnvFile?.();
} catch {
  /* sem .env: tudo bem, usamos os defaults */
}

const PORT = process.env.PORT || 3000;

const scraper = new GoogleMapsScraper({ headless: true });
const siteTextScraper = new SiteTextScraper();
const reportRenderer = new AuditReportRenderer();
const exportBundle = new ExportBundle({ reportRenderer });
const app = createServer({ scraper, siteTextScraper, reportRenderer, exportBundle });

app.listen(PORT, () => {
  console.log(`\n  Maps Leads Scraper · T3H4 rodando em: http://localhost:${PORT}\n`);
});
