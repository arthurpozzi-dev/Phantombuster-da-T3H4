/**
 * Orquestrador do pipeline de pós-processamento:
 *
 *   leads crus  →  LIMPEZA  →  FILTRO  →  SEPARAÇÃO (com site / sem site)
 *
 * Devolve as duas listas finais + estatísticas de quantos leads sobraram em
 * cada etapa (usadas no resumo do front-end). O enriquecimento (PageSpeed) é
 * uma etapa separada, disparada sob demanda (ver EnrichLeads.js).
 */
import { cleanLeads } from "./CleanLeads.js";
import { filterLeads } from "./FilterLeads.js";
import { splitLeads } from "./SplitLeads.js";

/**
 * @typedef {Object} PipelineStats
 * @property {number} bruto       total coletado
 * @property {number} limpos      após limpeza/dedupe
 * @property {number} filtrados   após filtro de reputação
 * @property {number} comSite     na lista "com site"
 * @property {number} semSite     na lista "sem site"
 */

/**
 * @param {Array<Record<string, any>>} rawLeads
 * @param {import("./FilterLeads.js").FilterOptions} [filterOptions]
 * @returns {{ comSite: import("../domain/Lead.js").Lead[], semSite: import("../domain/Lead.js").Lead[], stats: PipelineStats }}
 */
export function runPipeline(rawLeads = [], filterOptions = {}) {
  const limpos = cleanLeads(rawLeads);
  const filtrados = filterLeads(limpos, filterOptions);
  const { comSite, semSite } = splitLeads(filtrados);

  return {
    comSite,
    semSite,
    stats: {
      bruto: rawLeads.length,
      limpos: limpos.length,
      filtrados: filtrados.length,
      comSite: comSite.length,
      semSite: semSite.length,
    },
  };
}
