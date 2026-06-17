/**
 * Opções de launch do Chromium por sistema operacional.
 *
 * Extraído de GoogleMapsScraper para ser compartilhado pelos engines
 * (PlaywrightEngine, e como base do CloakBrowserEngine) e pelos renderizadores
 * que abrem navegador (PdfRenderer, BrowserEmailScraper).
 */
import { existsSync, readdirSync, symlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/** Caminhos comuns do Chromium/Chrome em Linux, em ordem de preferência. */
const LINUX_CHROMIUM_PATHS = [
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/snap/bin/chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
];

// Libs do sistema que o Chromium precisa (libnss3, libnspr4, libasound2…), quando
// extraídas localmente sem root (`.chromium-libs/`, ver README). Se a pasta existir,
// adicionamos ao LD_LIBRARY_PATH do processo do navegador. Em servidores onde as libs
// estão instaladas via apt, a pasta não existe e isto é um no-op.
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const LOCAL_CHROMIUM_LIBS = join(PROJECT_ROOT, ".chromium-libs", "extracted", "usr", "lib", "x86_64-linux-gnu");

/**
 * Garante os symlinks de *soname* das libs locais.
 *
 * A extração manual (`.chromium-libs/`) traz arquivos versionados (ex.:
 * `libasound.so.2.0.0`), mas o loader do Chromium procura pelo soname exato
 * (`libasound.so.2`). Sem esse link, o chrome-headless-shell do Playwright morre
 * com `error while loading shared libraries: libasound.so.2 ... not found`
 * (exit 127) — quebrando a exportação de PDF. Criamos os links que faltam
 * (`libfoo.so.N -> libfoo.so.N.M.K`) de forma idempotente, para o fix sobreviver
 * a uma re-extração das libs. Best-effort: qualquer erro é ignorado.
 */
function ensureLocalLibSonames() {
  try {
    for (const file of readdirSync(LOCAL_CHROMIUM_LIBS)) {
      // libasound.so.2.0.0 -> soname libasound.so.2 (corta no 1º componente de versão)
      const m = file.match(/^(.+\.so\.\d+)\.\d+/);
      if (!m) continue;
      const soname = m[1];
      if (file === soname || existsSync(join(LOCAL_CHROMIUM_LIBS, soname))) continue;
      try {
        symlinkSync(file, join(LOCAL_CHROMIUM_LIBS, soname));
      } catch {
        /* link já existe ou sem permissão — segue o jogo */
      }
    }
  } catch {
    /* pasta inacessível — no-op */
  }
}

/** Env do navegador com as libs locais no LD_LIBRARY_PATH, se existirem; senão undefined. */
export function browserEnv() {
  if (process.platform === "win32" || !existsSync(LOCAL_CHROMIUM_LIBS)) return undefined;
  ensureLocalLibSonames();
  const prev = process.env.LD_LIBRARY_PATH || "";
  return { ...process.env, LD_LIBRARY_PATH: prev ? `${LOCAL_CHROMIUM_LIBS}:${prev}` : LOCAL_CHROMIUM_LIBS };
}

/**
 * Monta as opções de launch do Chromium conforme o sistema operacional.
 *
 * - Windows: usa o Chromium que vem com o Playwright, como antes.
 * - Linux (servidor/WSL/container): usa o Chromium do sistema
 *   (`/usr/bin/chromium-browser` por padrão, ou o que existir, ou a env
 *   CHROMIUM_PATH) e adiciona as flags de sandbox necessárias para rodar sem
 *   privilégios (`--no-sandbox`), como num ambiente sandbox/CI.
 *
 * @param {boolean} headless
 * @returns {import("playwright").LaunchOptions}
 */
export function buildLaunchOptions(headless) {
  if (process.platform === "win32") {
    return { headless };
  }

  // Linux (e outros não-Windows): prioriza CHROMIUM_PATH, depois os caminhos conhecidos.
  const fromEnv = (process.env.CHROMIUM_PATH || "").trim();
  const env = browserEnv();
  // Valores especiais forçam o Chromium do próprio Playwright (sem executablePath).
  // Útil quando o único Chromium do sistema é um *snap* (ex.: WSL/Ubuntu), que não
  // funciona com o Playwright. Rode antes: `npx playwright install chromium`.
  if (["playwright", "bundled", "0"].includes(fromEnv.toLowerCase())) {
    return { headless, ...(env ? { env } : {}), args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] };
  }
  const executablePath =
    (fromEnv && existsSync(fromEnv) ? fromEnv : "") ||
    LINUX_CHROMIUM_PATHS.find((p) => existsSync(p)) ||
    undefined; // undefined => cai no Chromium do Playwright, se houver

  return {
    headless,
    ...(executablePath ? { executablePath } : {}),
    ...(env ? { env } : {}),
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  };
}
