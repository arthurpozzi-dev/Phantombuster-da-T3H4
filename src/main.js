/**
 * Composition Root.
 *
 * É aqui — e só aqui — que as implementações concretas (adaptadores) são
 * criadas e ligadas (injeção de dependência), mantendo as demais camadas
 * desacopladas. Também carrega variáveis de ambiente do arquivo .env, se existir.
 */
import { GoogleMapsScraper } from "./infrastructure/scraper/GoogleMapsScraper.js";
import { GoogleMapsGridScraper } from "./infrastructure/scraper/GoogleMapsGridScraper.js";
import { SiteTextScraper } from "./infrastructure/scraper/SiteTextScraper.js";
import { EmailScraper } from "./infrastructure/scraper/EmailScraper.js";
import { BrowserEmailScraper } from "./infrastructure/scraper/BrowserEmailScraper.js";
import { SocialSearchScraper } from "./infrastructure/scraper/SocialSearchScraper.js";
import { SiteHealthChecker } from "./infrastructure/scraper/SiteHealthChecker.js";
import { AuditReportRenderer } from "./infrastructure/report/AuditReportRenderer.js";
import { PdfRenderer } from "./infrastructure/report/PdfRenderer.js";
import { ExportBundle } from "./infrastructure/export/ExportBundle.js";
import { createEngineRegistry } from "./infrastructure/engine/registry.js";
import { LighthouseFleet } from "./infrastructure/lighthouse/LighthouseFleet.js";
import { createServer } from "./infrastructure/http/server.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Carrega .env (PAGESPEED_API_KEY, PORT) usando o recurso nativo do Node 22+.
try {
  process.loadEnvFile?.();
} catch {
  /* sem .env: tudo bem, usamos os defaults */
}

const PORT = process.env.PORT || 3000;

// Registry de engines de scraping (playwright | cloakbrowser | scrapling).
// O servidor resolve o engine por requisição a partir do parâmetro `engine`.
const engines = createEngineRegistry();

const scraper = new GoogleMapsScraper({ headless: true });
const gridScraper = new GoogleMapsGridScraper();
const siteTextScraper = new SiteTextScraper();
const emailScraper = new EmailScraper({
  // Timeout por requisição HTTP. Default 20s (era 10s): muitos sites lentos
  // estouravam 10s e caíam como falha. Configurável via EMAIL_TIMEOUT_MS.
  timeoutMs: parseInt(process.env.EMAIL_TIMEOUT_MS, 10) || 20000,
});
// Fábrica: 1 navegador por requisição de e-mails (evita que uma req feche o da outra).
// Recebe o engine escolhido (CloakBrowser anti-ban, etc.); sem engine, usa Playwright.
const makeBrowserEmailScraper = (engine) => new BrowserEmailScraper({ headless: true, engine });
const siteHealthChecker = new SiteHealthChecker();
const socialSearchScraper = new SocialSearchScraper();
const reportRenderer = new AuditReportRenderer();
const exportBundle = new ExportBundle({ reportRenderer });
// Fábrica: 1 navegador de PDF por requisição de exportação (isolamento entre reqs).
const makePdfRenderer = () => new PdfRenderer({ headless: true });
// Frota Lighthouse gerenciada pelo app (sobe N workers sob demanda; o front
// escolhe N). Os workers herdam o env (LH_CHROME_PATH, LH_USER_DATA_DIR, etc.).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const lighthouseFleet = new LighthouseFleet({
  serverScript: path.join(__dirname, "..", "lighthouse-server", "server.js"),
});
const app = createServer({
  scraper,
  gridScraper,
  siteTextScraper,
  emailScraper,
  makeBrowserEmailScraper,
  makePdfRenderer,
  reportRenderer,
  exportBundle,
  siteHealthChecker,
  socialSearchScraper,
  engines,
  lighthouseFleet,
});

app.listen(PORT, () => {
  console.log(`\n  Maps Leads Scraper · T3H4 rodando em: http://localhost:${PORT}\n`);
});

// Encerra engines (mata o sidecar Scrapling, fecha browsers) ao desligar.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    lighthouseFleet.closeAll();
    await engines.closeAll();
    process.exit(0);
  });
}
