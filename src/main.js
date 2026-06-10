/**
 * Composition Root.
 *
 * É aqui — e só aqui — que as implementações concretas (adaptadores) são
 * criadas e ligadas (injeção de dependência), mantendo as demais camadas
 * desacopladas. Também carrega variáveis de ambiente do arquivo .env, se existir.
 */
import { GoogleMapsScraper } from "./infrastructure/scraper/GoogleMapsScraper.js";
import { SiteTextScraper } from "./infrastructure/scraper/SiteTextScraper.js";
import { EmailScraper } from "./infrastructure/scraper/EmailScraper.js";
import { BrowserEmailScraper } from "./infrastructure/scraper/BrowserEmailScraper.js";
import { SiteHealthChecker } from "./infrastructure/scraper/SiteHealthChecker.js";
import { AuditReportRenderer } from "./infrastructure/report/AuditReportRenderer.js";
import { PdfRenderer } from "./infrastructure/report/PdfRenderer.js";
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
const emailScraper = new EmailScraper();
// Fábrica: 1 navegador por requisição de e-mails (evita que uma req feche o da outra).
const makeBrowserEmailScraper = () => new BrowserEmailScraper({ headless: true });
const siteHealthChecker = new SiteHealthChecker();
const reportRenderer = new AuditReportRenderer();
const exportBundle = new ExportBundle({ reportRenderer });
// Fábrica: 1 navegador de PDF por requisição de exportação (isolamento entre reqs).
const makePdfRenderer = () => new PdfRenderer({ headless: true });
const app = createServer({
  scraper,
  siteTextScraper,
  emailScraper,
  makeBrowserEmailScraper,
  makePdfRenderer,
  reportRenderer,
  exportBundle,
  siteHealthChecker,
});

app.listen(PORT, () => {
  console.log(`\n  Maps Leads Scraper · T3H4 rodando em: http://localhost:${PORT}\n`);
});
