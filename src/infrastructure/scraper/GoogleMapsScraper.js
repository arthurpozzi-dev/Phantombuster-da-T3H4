/**
 * Adaptador de coleta: Google Maps via Playwright (Chromium).
 *
 * Responsabilidade ÚNICA: navegar no Maps e devolver leads CRUS (texto bruto).
 * A normalização (parse de nota, telefone, etc.) e o pós-processamento ficam
 * nas camadas de domínio/aplicação — este arquivo não conhece as regras de
 * negócio.
 *
 * O HTML do Maps muda com frequência; os seletores CSS (`.hfpxzc`, `.qBF1Pd`,
 * `data-item-id`…) podem precisar de ajuste se a coleta parar de funcionar.
 */
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { SOCIAL_DOMAINS } from "../../domain/classification.js";

/** Caminhos comuns do Chromium/Chrome em Linux, em ordem de preferência. */
const LINUX_CHROMIUM_PATHS = [
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/snap/bin/chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
];

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
  const executablePath =
    (fromEnv && existsSync(fromEnv) ? fromEnv : "") ||
    LINUX_CHROMIUM_PATHS.find((p) => existsSync(p)) ||
    undefined; // undefined => cai no Chromium do Playwright, se houver

  return {
    headless,
    ...(executablePath ? { executablePath } : {}),
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  };
}

/**
 * Normaliza a entrada do usuário: aceita um link completo do Google Maps OU um
 * termo de busca simples (ex.: "restaurantes em São Carlos").
 * @param {string} input
 * @returns {string} URL de pesquisa do Maps.
 */
export function buildSearchUrl(input) {
  const value = (input || "").trim();
  if (!value) throw new Error("Informe um link do Google Maps ou um termo de busca.");

  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (!url.searchParams.has("hl")) url.searchParams.set("hl", "pt-BR");
      return url.toString();
    } catch {
      return value;
    }
  }
  return `https://www.google.com/maps/search/${encodeURIComponent(value)}?hl=pt-BR`;
}

/** Aceita a tela de consentimento de cookies do Google, se aparecer. */
async function handleConsent(page) {
  try {
    const btn = page.locator(
      'button[aria-label*="Aceitar"], button[aria-label*="Accept all"], form[action*="consent"] button, button:has-text("Aceitar tudo"), button:has-text("Accept all")'
    );
    if (await btn.first().isVisible({ timeout: 4000 })) {
      await btn.first().click();
      await page.waitForTimeout(1500);
    }
  } catch {
    /* sem tela de consentimento */
  }
}

/** Conta os cards carregados no feed. */
const countCards = (page) => page.locator('div[role="feed"] a.hfpxzc').count();

/**
 * Rola o painel de resultados até carregar tudo (ou até o limite).
 *
 * Robustez: o Maps virtualiza/lazy-loada a lista. Em vez de uma espera fixa,
 * rolamos o ÚLTIMO card para a viewport (dispara o carregamento melhor que um
 * scrollTo) e aguardamos DINAMICAMENTE o número de cards crescer. Só desistimos
 * após várias rodadas seguidas sem nenhum crescimento — evitando parar cedo
 * demais em conexões lentas.
 */
async function scrollFeed(page, { maxResults, onProgress }) {
  const feedSel = 'div[role="feed"]';
  await page.waitForSelector(feedSel, { timeout: 20000 });

  let stable = 0;
  const MAX_STABLE = 8; // rodadas seguidas sem crescer antes de desistir
  const MAX_ROUNDS = 200;

  for (let i = 0; i < MAX_ROUNDS; i++) {
    const count = await countCards(page);
    onProgress?.({ phase: "scroll", found: count });
    if (maxResults && count >= maxResults) break;

    const reachedEnd = await page
      .locator(
        'span:has-text("Você chegou ao fim da lista"), span:has-text("You\'ve reached the end of the list")'
      )
      .first()
      .isVisible()
      .catch(() => false);
    if (reachedEnd) break;

    // Empurra o final da lista para dentro da viewport (gatilho de lazy-load).
    await page.evaluate((sel) => {
      const feed = document.querySelector(sel);
      if (!feed) return;
      const cards = feed.querySelectorAll("a.hfpxzc");
      const last = cards[cards.length - 1];
      if (last) last.scrollIntoView({ block: "end", behavior: "instant" });
      feed.scrollBy(0, 1200);
    }, feedSel);

    // Espera dinâmica: até ~4s, saindo assim que aparecerem cards novos.
    let grew = false;
    for (let w = 0; w < 8; w++) {
      await page.waitForTimeout(500);
      if ((await countCards(page)) > count) {
        grew = true;
        break;
      }
    }

    if (grew) stable = 0;
    else if (++stable >= MAX_STABLE) break;
  }
}

/** Extrai os dados básicos visíveis em cada card da lista. */
async function extractCards(page, maxResults) {
  return page.evaluate((limit) => {
    const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
    const cards = Array.from(document.querySelectorAll('div[role="feed"] > div'))
      .map((el) => el.querySelector("a.hfpxzc"))
      .filter(Boolean);

    const out = [];
    for (const link of cards) {
      const container = link.parentElement;
      const name =
        clean(link.getAttribute("aria-label")) ||
        clean(container?.querySelector(".qBF1Pd")?.textContent);
      if (!name) continue;

      const ratingText = clean(container?.querySelector("span.MW4etd")?.textContent);
      const reviewsText = clean(container?.querySelector("span.UY7F9")?.textContent);

      out.push({
        nome: name,
        categoria: "",
        nota: ratingText,
        avaliacoes: reviewsText,
        telefone: "",
        site_bruto: "",
        redes_sociais: "",
        descricao: "",
        link_maps: link.href || "",
      });
      if (limit && out.length >= limit) break;
    }
    return out;
  }, maxResults);
}

/**
 * Lê os campos do painel de detalhe JÁ ABERTO na página (nome, categoria, nota,
 * avaliações, telefone, site, redes sociais, descrição).
 *
 * Não clica nem navega — quem garante que o painel é o do lugar certo é o
 * chamador (que navega direto na URL única do lugar). Isso elimina a leitura de
 * dados trocados que acontecia ao clicar card a card.
 */
function readOpenDetail(page, socialDomains) {
  return page.evaluate((socials) => {
    const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
    const byItem = (id) => document.querySelector(`[data-item-id="${id}"]`);
    const byItemStart = (p) => document.querySelector(`[data-item-id^="${p}"]`);
    const stripLabel = (el) => {
      if (!el) return "";
      const m = (el.getAttribute("aria-label") || "").match(/:\s*(.+)$/);
      return m ? clean(m[1]) : clean(el.textContent);
    };

    const nome = clean(document.querySelector("h1.DUwDvf")?.textContent);
    const nota = clean(
      document.querySelector("div.F7nice span[aria-hidden='true']")?.textContent
    );
    const avaliacoes = clean(
      document.querySelector(
        "div.F7nice span[aria-label*='avaliaç'], div.F7nice span[aria-label*='review']"
      )?.textContent
    );
    const categoria = clean(document.querySelector("button[jsaction*='category']")?.textContent);
    const telefone = stripLabel(byItemStart("phone:tel:"));
    const siteBruto = byItem("authority")?.getAttribute("href") || "";

    // Descrição / resumo editorial, quando existe.
    const descricao = clean(
      document.querySelector(".PYvSYb")?.textContent ||
        document.querySelector("[data-item-id='editorial']")?.textContent ||
        document.querySelector(".WeS02d .fontBodyMedium")?.textContent ||
        ""
    );

    // Redes sociais: varre todos os links do painel procurando domínios sociais.
    const redes = new Set();
    for (const a of document.querySelectorAll('a[href^="http"]')) {
      const href = a.getAttribute("href") || "";
      if (socials.some((d) => href.includes(d))) redes.add(href);
    }

    return {
      nome,
      categoria,
      nota,
      avaliacoes,
      telefone,
      site_bruto: siteBruto,
      redes_sociais: [...redes].join(" | "),
      descricao,
    };
  }, socialDomains);
}

/**
 * Adaptador de scraping do Google Maps.
 */
export class GoogleMapsScraper {
  /**
   * @param {Object} [options]
   * @param {boolean} [options.headless=true]
   */
  constructor({ headless = true } = {}) {
    this.headless = headless;
  }

  /**
   * Coleta os estabelecimentos de uma busca/link do Maps.
   * @param {Object} opts
   * @param {string} opts.input          link do Maps ou termo de busca
   * @param {number} [opts.maxResults=0] limite de resultados (0 = todos)
   * @param {boolean} [opts.deep=true]   abre cada card para dados completos
   * @param {(p: any) => void} [opts.onProgress]
   * @returns {Promise<Array<Record<string, any>>>} leads crus.
   */
  async scrape({ input, maxResults = 0, deep = true, onProgress }) {
    const url = buildSearchUrl(input);
    const progress = (p) => onProgress?.(p);

    const browser = await chromium.launch(buildLaunchOptions(this.headless));
    const context = await browser.newContext({
      locale: "pt-BR",
      viewport: { width: 1280, height: 900 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    });
    const page = await context.newPage();

    try {
      progress({ phase: "open", message: "Abrindo o Google Maps..." });
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await handleConsent(page);

      // Pode cair direto num local único (URL de place) -> trata como 1 resultado.
      const isSinglePlace = await page
        .locator("h1.DUwDvf")
        .first()
        .isVisible({ timeout: 5000 })
        .catch(() => false);
      const hasFeed = await page
        .locator('div[role="feed"]')
        .isVisible()
        .catch(() => false);

      if (isSinglePlace && !hasFeed) {
        progress({ phase: "detail", message: "Local único detectado." });
        const detail = await page.evaluate((socials) => {
          const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
          const byItem = (id) => document.querySelector(`[data-item-id="${id}"]`);
          const byItemStart = (p) => document.querySelector(`[data-item-id^="${p}"]`);
          const stripLabel = (el) => {
            if (!el) return "";
            const m = (el.getAttribute("aria-label") || "").match(/:\s*(.+)$/);
            return m ? clean(m[1]) : clean(el.textContent);
          };
          const redes = new Set();
          for (const a of document.querySelectorAll('a[href^="http"]')) {
            const href = a.getAttribute("href") || "";
            if (socials.some((d) => href.includes(d))) redes.add(href);
          }
          return {
            nome: clean(document.querySelector("h1.DUwDvf")?.textContent),
            categoria: clean(document.querySelector("button[jsaction*='category']")?.textContent),
            nota: clean(
              document.querySelector("div.F7nice span[aria-hidden='true']")?.textContent
            ),
            avaliacoes: clean(
              document.querySelector(
                "div.F7nice span[aria-label*='avaliaç'], div.F7nice span[aria-label*='review']"
              )?.textContent
            ),
            telefone: stripLabel(byItemStart("phone:tel:")),
            site_bruto: byItem("authority")?.getAttribute("href") || "",
            redes_sociais: [...redes].join(" | "),
            descricao: clean(document.querySelector(".PYvSYb")?.textContent || ""),
            link_maps: location.href,
          };
        }, SOCIAL_DOMAINS);
        return [detail];
      }

      progress({ phase: "scroll", message: "Rolando a lista de resultados..." });
      await scrollFeed(page, { maxResults, onProgress });

      let results = await extractCards(page, maxResults);
      progress({
        phase: "cards",
        message: `${results.length} estabelecimentos encontrados.`,
        found: results.length,
      });

      if (deep && results.length) {
        // Coleta detalhada DETERMINÍSTICA: em vez de clicar card a card (que
        // deixava o painel dessincronizado e trazia dados trocados), navegamos
        // direto na URL única de cada lugar, em paralelo (pool de abas).
        const total = results.length;
        let done = 0;
        let next = 0;

        const worker = async () => {
          const wp = await context.newPage();
          // Bloqueia imagens/fontes/mídia para acelerar bastante o carregamento.
          await wp.route("**/*", (route) => {
            const t = route.request().resourceType();
            return t === "image" || t === "media" || t === "font"
              ? route.abort()
              : route.continue();
          });
          try {
            while (next < total) {
              const i = next++;
              const url = results[i].link_maps;
              if (url) {
                try {
                  await wp.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
                  await wp.waitForSelector("h1.DUwDvf", { timeout: 8000 }).catch(() => {});
                  const d = await readOpenDetail(wp, SOCIAL_DOMAINS);
                  results[i] = {
                    ...results[i],
                    nome: d.nome || results[i].nome,
                    categoria: d.categoria || results[i].categoria,
                    nota: d.nota || results[i].nota,
                    avaliacoes: d.avaliacoes || results[i].avaliacoes,
                    telefone: d.telefone || results[i].telefone,
                    site_bruto: d.site_bruto || results[i].site_bruto,
                    redes_sociais: d.redes_sociais || results[i].redes_sociais,
                    descricao: d.descricao || results[i].descricao,
                  };
                } catch {
                  /* mantém os dados do card se a navegação falhar */
                }
              }
              progress({
                phase: "detail",
                message: `Coletando detalhes ${++done}/${total}...`,
                current: done,
                total,
              });
            }
          } finally {
            await wp.close();
          }
        };

        const DEEP_CONCURRENCY = 4;
        await Promise.all(
          Array.from({ length: Math.min(DEEP_CONCURRENCY, total) }, worker)
        );
      }

      progress({ phase: "done", message: "Coleta concluída.", found: results.length });
      return results;
    } finally {
      await browser.close();
    }
  }
}
