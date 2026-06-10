/**
 * Caso de uso: ENRIQUECIMENTO de e-mails da lista "com site".
 *
 * Faz um scraping COMPLETO de e-mails (home + páginas de contato) e preenche
 * `site_emails`, em duas fases:
 *
 *   Fase 1 — RÁPIDA (fetch, via `emailScraper`): cobre a grande maioria dos
 *            sites; barata e paralela.
 *   Fase 2 — NAVEGADOR (opcional, via `options.browserScraper`): roda SÓ nos
 *            leads que ficaram sem e-mail, renderizando o site num browser real
 *            para alcançar páginas 100% JavaScript. Cara, então com pouca
 *            concorrência e só sob demanda.
 *
 * Sempre MESCLA com os e-mails que o lead já tiver — rodar este passo só
 * acrescenta, nunca perde, contatos. Erros por item são tolerados: o lead
 * mantém o que tinha e o motivo vai para `site_emails_erro`.
 */
import { runPool } from "./concurrentPool.js";

const DEFAULT_CONCURRENCY = 6;
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
 * @param {{ scrapeEmails: (url:string)=>Promise<{emails:string[], pagesVisited:number}> }} emailScraper
 * @param {(p: { fase:"rápido"|"navegador", current:number, total:number, nome:string, encontrados:number, erro?:string }) => void} [onProgress]
 * @param {{ concurrency?: number, browserScraper?: { scrapeEmails:(url:string)=>Promise<{emails:string[]}> }, browserConcurrency?: number }} [options]
 * @returns {Promise<{ leads: import("../domain/Lead.js").Lead[], ok: number, semEmail: number, falhas: number, renderizados: number }>}
 */
export async function enrichEmails(comSite = [], emailScraper, onProgress, options = {}) {
  // ---- Fase 1: scraping rápido (fetch) ----------------------------------
  const total = comSite.length;
  let done = 0;
  const leads = await runPool(comSite, {
    concurrency: options.concurrency || DEFAULT_CONCURRENCY,
    task: async (lead) => {
      try {
        const { emails } = await emailScraper.scrapeEmails(lead.site);
        const merged = mergeEmails(lead.site_emails, emails);
        return { ...lead, site_emails: merged.join(" | "), site_emails_erro: "" };
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
            const { emails } = await browserScraper.scrapeEmails(lead.site);
            const merged = mergeEmails(lead.site_emails, emails);
            if (merged.length) {
              renderizados++;
              // Achou via navegador: limpa o erro do fetch (o site existe, só era JS).
              leads[i] = { ...lead, site_emails: merged.join(" | "), site_emails_erro: "" };
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

  return { leads, ok, semEmail, falhas, renderizados };
}
