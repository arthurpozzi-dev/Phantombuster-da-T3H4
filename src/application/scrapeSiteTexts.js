/**
 * Caso de uso: puxar o TEXTO de cada site da lista "com site".
 *
 * Visita cada site (via porta `siteTextScraper`) em paralelo limitado e grava o
 * texto condensado em `site_texto`. Erros por item são tolerados (texto vazio +
 * motivo em `site_texto_erro`).
 */
import { runPool } from "./concurrentPool.js";

const DEFAULT_CONCURRENCY = 8;

/**
 * @param {import("../domain/Lead.js").Lead[]} comSite
 * @param {{ fetchText: (url:string)=>Promise<{text:string}> }} siteTextScraper
 * @param {(p: { current:number, total:number, nome:string, erro?:string }) => void} [onProgress]
 * @param {{ concurrency?: number }} [options]
 * @returns {Promise<{ leads: import("../domain/Lead.js").Lead[], ok: number, falhas: number }>}
 */
export async function scrapeSiteTexts(comSite = [], siteTextScraper, onProgress, options = {}) {
  let ok = 0;
  let falhas = 0;

  const leads = await runPool(comSite, {
    concurrency: options.concurrency || DEFAULT_CONCURRENCY,
    task: async (lead) => {
      try {
        const { text } = await siteTextScraper.fetchText(lead.site);
        ok++;
        return { ...lead, site_texto: text, site_texto_erro: "" };
      } catch (e) {
        falhas++;
        return { ...lead, site_texto: "", site_texto_erro: e?.message || "falha" };
      }
    },
    onDone: (done, total, lead, result) =>
      onProgress?.({ current: done, total, nome: lead.nome, erro: result.site_texto_erro || undefined }),
  });

  return { leads, ok, falhas };
}
