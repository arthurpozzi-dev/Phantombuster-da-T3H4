import { chromium } from "playwright";

/**
 * Normaliza a entrada do usuario: aceita um link completo do Google Maps
 * OU um termo de busca simples (ex: "restaurantes em Sao Carlos").
 */
export function buildSearchUrl(input) {
  const value = (input || "").trim();
  if (!value) throw new Error("Informe um link do Google Maps ou um termo de busca.");

  if (/^https?:\/\//i.test(value)) {
    // Ja e uma URL do Maps -> usa direto. Forca lingua/regiao PT-BR.
    try {
      const url = new URL(value);
      if (!url.searchParams.has("hl")) url.searchParams.set("hl", "pt-BR");
      return url.toString();
    } catch {
      return value;
    }
  }

  // Termo de busca puro -> monta a URL de pesquisa do Maps.
  return `https://www.google.com/maps/search/${encodeURIComponent(value)}?hl=pt-BR`;
}

/** Tenta aceitar a tela de consentimento de cookies do Google, se aparecer. */
async function handleConsent(page) {
  try {
    const consentButton = page.locator(
      'button[aria-label*="Aceitar"], button[aria-label*="Accept all"], form[action*="consent"] button, button:has-text("Aceitar tudo"), button:has-text("Accept all")'
    );
    if (await consentButton.first().isVisible({ timeout: 4000 })) {
      await consentButton.first().click();
      await page.waitForTimeout(1500);
    }
  } catch {
    /* sem tela de consentimento, segue o jogo */
  }
}

/**
 * Rola o painel de resultados ate carregar tudo (ou ate o limite).
 * Retorna quando o Maps mostra "Voce chegou ao fim da lista" ou
 * quando o numero de cards para de crescer.
 */
async function scrollFeed(page, { maxResults, onProgress }) {
  const feedSelector = 'div[role="feed"]';
  await page.waitForSelector(feedSelector, { timeout: 20000 });

  let previousCount = 0;
  let stableRounds = 0;

  for (let i = 0; i < 60; i++) {
    const count = await page.locator('div[role="feed"] a.hfpxzc').count();
    if (onProgress) onProgress({ phase: "scroll", found: count });

    if (maxResults && count >= maxResults) break;

    // Detecta o fim da lista.
    const reachedEnd = await page
      .locator('span:has-text("Você chegou ao fim da lista"), span:has-text("You\'ve reached the end of the list")')
      .first()
      .isVisible()
      .catch(() => false);
    if (reachedEnd) break;

    if (count === previousCount) {
      stableRounds++;
      if (stableRounds >= 4) break; // nao carregou nada novo em 4 rodadas
    } else {
      stableRounds = 0;
    }
    previousCount = count;

    // Rola o ultimo card para dentro da viewport para forcar o lazy-load.
    await page.evaluate(() => {
      const feed = document.querySelector('div[role="feed"]');
      if (feed) feed.scrollTo(0, feed.scrollHeight);
    });
    await page.waitForTimeout(1600);
  }
}

/** Extrai os dados basicos visiveis em cada card da lista. */
async function extractCards(page, maxResults) {
  return page.evaluate((limit) => {
    const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

    const cards = Array.from(document.querySelectorAll('div[role="feed"] > div'))
      .map((el) => el.querySelector("a.hfpxzc"))
      .filter(Boolean);

    const out = [];
    for (const link of cards) {
      const card = link.closest("div");
      const container = link.parentElement;

      const name =
        clean(link.getAttribute("aria-label")) ||
        clean(container?.querySelector(".qBF1Pd")?.textContent);
      if (!name) continue;

      const ratingText = clean(container?.querySelector("span.MW4etd")?.textContent);
      const reviewsText = clean(container?.querySelector("span.UY7F9")?.textContent).replace(/[()]/g, "");

      // As linhas .W4Efsd costumam trazer categoria, endereco e telefone.
      const infoSpans = Array.from(container?.querySelectorAll(".W4Efsd") || [])
        .map((n) => clean(n.textContent))
        .filter(Boolean);
      const infoJoined = infoSpans.join(" · ");

      // Tenta achar telefone no texto do card (formato BR).
      const phoneMatch = infoJoined.match(/(\(?\d{2}\)?\s?\d{4,5}[-\s]?\d{4})/);

      const websiteEl = container?.querySelector('a.lcr4fd, a[data-value="Website"]');

      out.push({
        nome: name,
        categoria: clean(container?.querySelector(".W4Efsd span[jsaction]")?.textContent) || "",
        nota: ratingText || "",
        avaliacoes: reviewsText || "",
        telefone: phoneMatch ? phoneMatch[1] : "",
        endereco: "",
        site: websiteEl?.getAttribute("href") || "",
        info: infoJoined,
        link_maps: link.href || "",
      });

      if (limit && out.length >= limit) break;
    }
    return out;
  }, maxResults);
}

/** Abre o painel de detalhe de um card e extrai telefone, site, endereco e categoria. */
async function extractDetail(page, link) {
  try {
    await link.click({ timeout: 8000 });
  } catch {
    return null;
  }

  // Espera o painel de detalhe carregar (titulo h1).
  await page.waitForSelector("h1.DUwDvf", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(900);

  return page.evaluate(() => {
    const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
    const byItem = (id) => document.querySelector(`[data-item-id="${id}"]`);
    const byItemStart = (prefix) => document.querySelector(`[data-item-id^="${prefix}"]`);

    const stripLabel = (el) => {
      if (!el) return "";
      const aria = el.getAttribute("aria-label") || "";
      const txt = clean(el.textContent);
      // aria-label costuma ser "Telefone: (16) ...", "Endereco: ..."
      const m = aria.match(/:\s*(.+)$/);
      return m ? clean(m[1]) : txt;
    };

    const nome = clean(document.querySelector("h1.DUwDvf")?.textContent);
    const nota = clean(document.querySelector("div.F7nice span[aria-hidden='true']")?.textContent);
    const avaliacoes = clean(
      document.querySelector("div.F7nice span[aria-label*='avaliaç'], div.F7nice span[aria-label*='review']")?.textContent
    ).replace(/[()]/g, "");
    const categoria = clean(document.querySelector("button[jsaction*='category']")?.textContent);
    const endereco = stripLabel(byItem("address"));
    const telefone = stripLabel(byItemStart("phone:tel:"));
    const siteEl = byItem("authority");
    const site = siteEl?.getAttribute("href") || "";
    const plusCode = stripLabel(byItem("oloc"));

    return { nome, nota, avaliacoes, categoria, endereco, telefone, site, plus_code: plusCode };
  });
}

/**
 * Funcao principal: recebe o link/termo e devolve a lista de estabelecimentos.
 * @param {object} opts
 * @param {string} opts.input         link do Maps ou termo de busca
 * @param {number} [opts.maxResults]  limite de resultados (0 = todos)
 * @param {boolean} [opts.deep]       true = abre cada card p/ pegar telefone/site/endereco
 * @param {boolean} [opts.headless]   roda sem janela (default true)
 * @param {function} [opts.onProgress]
 */
export async function scrapeMaps({ input, maxResults = 0, deep = true, headless = true, onProgress }) {
  const url = buildSearchUrl(input);
  const progress = (p) => onProgress && onProgress(p);

  const browser = await chromium.launch({ headless });
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

    // Pode cair direto num local unico (URL de place) -> trata como 1 resultado.
    const isSinglePlace = await page
      .locator("h1.DUwDvf")
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    if (isSinglePlace && !(await page.locator('div[role="feed"]').isVisible().catch(() => false))) {
      progress({ phase: "detail", message: "Local unico detectado." });
      const detail = await page.evaluate(() => {
        const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
        const byItem = (id) => document.querySelector(`[data-item-id="${id}"]`);
        const byItemStart = (p) => document.querySelector(`[data-item-id^="${p}"]`);
        const stripLabel = (el) => {
          if (!el) return "";
          const m = (el.getAttribute("aria-label") || "").match(/:\s*(.+)$/);
          return m ? clean(m[1]) : clean(el.textContent);
        };
        return {
          nome: clean(document.querySelector("h1.DUwDvf")?.textContent),
          categoria: clean(document.querySelector("button[jsaction*='category']")?.textContent),
          nota: clean(document.querySelector("div.F7nice span[aria-hidden='true']")?.textContent),
          avaliacoes: "",
          telefone: stripLabel(byItemStart("phone:tel:")),
          endereco: stripLabel(byItem("address")),
          site: byItem("authority")?.getAttribute("href") || "",
          link_maps: location.href,
        };
      });
      return [detail];
    }

    progress({ phase: "scroll", message: "Rolando a lista de resultados..." });
    await scrollFeed(page, { maxResults, onProgress });

    let results = await extractCards(page, maxResults);
    progress({ phase: "cards", message: `${results.length} estabelecimentos encontrados.`, found: results.length });

    if (deep && results.length) {
      const links = await page.locator('div[role="feed"] a.hfpxzc').all();
      const total = Math.min(results.length, links.length);
      for (let i = 0; i < total; i++) {
        progress({ phase: "detail", message: `Coletando detalhes ${i + 1}/${total}...`, current: i + 1, total });
        const detail = await extractDetail(page, links[i]);
        if (detail) {
          results[i] = {
            ...results[i],
            nome: detail.nome || results[i].nome,
            categoria: detail.categoria || results[i].categoria,
            nota: detail.nota || results[i].nota,
            avaliacoes: detail.avaliacoes || results[i].avaliacoes,
            telefone: detail.telefone || results[i].telefone,
            endereco: detail.endereco || results[i].endereco,
            site: detail.site || results[i].site,
            plus_code: detail.plus_code || "",
          };
        }
        await page.waitForTimeout(300);
      }
    }

    // Limpa o campo "info" auxiliar antes de devolver.
    results = results.map(({ info, ...rest }) => rest);
    progress({ phase: "done", message: "Concluido.", found: results.length });
    return results;
  } finally {
    await browser.close();
  }
}
