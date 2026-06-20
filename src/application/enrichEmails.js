/**
 * Caso de uso: ENRIQUECIMENTO de e-mails da lista "com site".
 *
 * Faz um scraping COMPLETO de e-mails (home + páginas de contato) e preenche
 * `site_emails`, numa CASCATA de até três fases (cada uma só pega o que a
 * anterior não resolveu — do mais barato ao mais caro):
 *
 *   Fase 1 — RÁPIDA (fetch nativo, via `emailScraper`): cobre a grande maioria
 *            dos sites; barata e paralela.
 *   Fase 1.5 — ANTI-BAN (opcional, via `options.engineScraper`): re-tenta SÓ os
 *            sites que BLOQUEARAM o fetch nativo (Cloudflare/403/TLS), usando um
 *            engine em modo HTTP (Scrapling fast) — sem navegador, ainda barato.
 *   Fase 2 — NAVEGADOR (opcional, via `options.browserScraper`): roda SÓ nos
 *            leads que ficaram sem e-mail, renderizando o site num browser real
 *            para alcançar páginas 100% JavaScript. Cara, então com pouca
 *            concorrência e só sob demanda.
 *
 * Sempre MESCLA com os e-mails que o lead já tiver — rodar este passo só
 * acrescenta, nunca perde, contatos. Erros por item são tolerados: o lead
 * mantém o que tinha e o motivo vai para `site_emails_erro`.
 */
import { mergeSocialLinks, recordSocialSources } from "../domain/classification.js";
import { runPool } from "./concurrentPool.js";
import { cacheKey } from "./jobCache.js";

const DEFAULT_CONCURRENCY = 20; // fetch nativo: I/O puro, escala bem
const DEFAULT_ENGINE_CONCURRENCY = 4;
const DEFAULT_BROWSER_CONCURRENCY = 2;

/** Une e deduplica duas listas de e-mails (em minúsculas). */
function mergeEmails(existing, found) {
  const set = new Set(
    (existing || "")
      .split(" | ")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
  for (const e of found) set.add(e);
  return [...set];
}

/** Quantos e-mails há no campo `site_emails` de um lead. */
const emailCount = (lead) => (lead.site_emails || "").split(" | ").filter(Boolean).length;

/**
 * @param {import("../domain/Lead.js").Lead[]} comSite
 * @param {{ scrapeContacts: (url:string)=>Promise<{emails:string[], socials:string[], pagesVisited:number}> }} emailScraper
 * @param {(p: { fase:"rápido"|"navegador", current:number, total:number, nome:string, encontrados:number, erro?:string }) => void} [onProgress]
 * @param {{ concurrency?: number, engineScraper?: { scrapeContacts:(url:string)=>Promise<{emails:string[],socials:string[]}> }, engineConcurrency?: number, browserScraper?: { scrapeContacts:(url:string)=>Promise<{emails:string[],socials:string[]}> }, browserConcurrency?: number }} [options]
 * @returns {Promise<{ leads: import("../domain/Lead.js").Lead[], ok: number, semEmail: number, falhas: number, renderizados: number, antiBan: number }>}
 */
export async function enrichEmails(comSite = [], emailScraper, onProgress, options = {}) {
  // ---- Fase 1: scraping rápido (fetch) ----------------------------------
  const total = comSite.length;
  let done = 0;

  // Wrapper que deduplica chamadas por domínio, se pageCache foi fornecido.
  const pageCache = options.pageCache;
  const scrapeContacts = (url) =>
    pageCache ? pageCache.run(cacheKey(url), () => emailScraper.scrapeContacts(url)) : emailScraper.scrapeContacts(url);

  const leads = await runPool(comSite, {
    concurrency: options.concurrency || DEFAULT_CONCURRENCY,
    task: async (lead) => {
      try {
        // Mesmo download serve aos dois: e-mails e redes sociais (reuso interno).
        const { emails, socials } = await scrapeContacts(lead.site);
        const merged = mergeEmails(lead.site_emails, emails);
        const antesRedes = lead.redes_sociais || "";
        const redes = mergeSocialLinks(antesRedes, socials);
        return {
          ...lead,
          site_emails: merged.join(" | "),
          redes_sociais: redes,
          redes_fontes: recordSocialSources(lead.redes_fontes, antesRedes, redes, "site"),
          site_emails_erro: "",
        };
      } catch (e) {
        return { ...lead, site_emails_erro: e?.message || "falha" };
      }
    },
    onDone: (d, t, lead, result) =>
      onProgress?.({
        fase: "rápido",
        current: ++done,
        total,
        nome: lead.nome,
        encontrados: emailCount(result),
        erro: result.site_emails_erro || undefined,
      }),
  });

  // ---- Fase 1.5: re-tentativa ANTI-BAN (engine HTTP) p/ quem NÃO carregou ----
  // Cascata: a Fase 1 usa fetch nativo (rápido). Sites que BLOQUEIAM o fetch
  // (Cloudflare/403/TLS) caem aqui e são re-tentados via engine em modo HTTP
  // (Scrapling fast = impersonação de TLS) — sem navegador, barato e paralelo.
  // Só re-tenta quem ERROU o carregamento; quem carregou mas não tinha e-mail é
  // caso de JS → vai para o navegador (Fase 2).
  let antiBan = 0;
  const engineScraper = options.engineScraper;
  if (engineScraper) {
    const bloqueados = leads.map((lead, i) => ({ lead, i })).filter(({ lead }) => lead.site_emails_erro);
    if (bloqueados.length) {
      const eTotal = bloqueados.length;
      let eDone = 0;
      const scrapeViaEngine = (url) =>
        pageCache ? pageCache.run("eng:" + cacheKey(url), () => engineScraper.scrapeContacts(url)) : engineScraper.scrapeContacts(url);
      await runPool(bloqueados, {
        concurrency: options.engineConcurrency || DEFAULT_ENGINE_CONCURRENCY,
        task: async ({ lead, i }) => {
          try {
            const { emails, socials } = await scrapeViaEngine(lead.site);
            const merged = mergeEmails(lead.site_emails, emails);
            const antesRedes = lead.redes_sociais || "";
            const redes = mergeSocialLinks(antesRedes, socials);
            const fontes = recordSocialSources(lead.redes_fontes, antesRedes, redes, "site");
            if (merged.length) antiBan++; // placar: só conta quem rendeu e-mail
            // O engine NÃO lançou => o site carregou: limpa o erro do fetch nativo
            // mesmo sem e-mail (vira "sem e-mail", não "falha"). Espelha as redes.
            leads[i] = {
              ...lead,
              site_emails: merged.join(" | "),
              redes_sociais: redes,
              redes_fontes: fontes,
              site_emails_erro: "",
            };
          } catch {
            /* engine também não alcançou: mantém o erro da Fase 1 (tenta navegador) */
          }
        },
        onDone: (d, t, { lead, i }) =>
          onProgress?.({ fase: "anti-ban", current: ++eDone, total: eTotal, nome: lead.nome, encontrados: emailCount(leads[i]) }),
      });
    }
  }

  // ---- Fase 2: fallback com navegador (só para quem ficou sem e-mail) ----
  let renderizados = 0;
  const browserScraper = options.browserScraper;
  if (browserScraper) {
    const pendentes = leads.map((lead, i) => ({ lead, i })).filter(({ lead }) => emailCount(lead) === 0);
    if (pendentes.length) {
      const bTotal = pendentes.length;
      let bDone = 0;
      await runPool(pendentes, {
        concurrency: options.browserConcurrency || DEFAULT_BROWSER_CONCURRENCY,
        task: async ({ lead, i }) => {
          try {
            const { emails, socials } = await browserScraper.scrapeContacts(lead.site);
            const merged = mergeEmails(lead.site_emails, emails);
            const antesRedes = lead.redes_sociais || "";
            const redes = mergeSocialLinks(antesRedes, socials);
            const fontes = recordSocialSources(lead.redes_fontes, antesRedes, redes, "navegador");
            if (merged.length) {
              renderizados++;
              // Achou via navegador: limpa o erro do fetch (o site existe, só era JS).
              leads[i] = { ...lead, site_emails: merged.join(" | "), redes_sociais: redes, redes_fontes: fontes, site_emails_erro: "" };
            } else if (redes !== antesRedes) {
              // Sem e-mail novo, mas achou rede social: ainda vale guardar.
              leads[i] = { ...lead, redes_sociais: redes, redes_fontes: fontes };
            }
          } catch {
            /* nem o navegador resolveu: mantém o estado da fase 1 */
          }
        },
        onDone: (d, t, { lead, i }) =>
          onProgress?.({
            fase: "navegador",
            current: ++bDone,
            total: bTotal,
            nome: lead.nome,
            encontrados: emailCount(leads[i]),
          }),
      });
    }
  }

  // ---- Contagem final ----------------------------------------------------
  let ok = 0;
  let semEmail = 0;
  let falhas = 0;
  for (const lead of leads) {
    if (emailCount(lead)) ok++;
    else if (lead.site_emails_erro) falhas++; // não carregou (nem fetch nem navegador)
    else semEmail++; // carregou, mas sem e-mail
  }

  return { leads, ok, semEmail, falhas, renderizados, antiBan };
}
