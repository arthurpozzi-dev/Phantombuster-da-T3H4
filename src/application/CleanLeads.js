/**
 * Caso de uso: LIMPEZA da lista de leads.
 *
 * Faz APENAS deduplicação — não descarta leads por estarem "vazios" ou sem
 * contato. A chave de deduplicação é o PLACE-ID do Google Maps (identificador
 * único do estabelecimento extraído do link): dois cards do mesmo lugar têm o
 * mesmo id e são fundidos (mesclando campos vazios de um com os do outro);
 * lugares diferentes NUNCA são fundidos, mesmo que tenham nome igual (franquias).
 *
 * Fallback (quando o link não traz o id): nome normalizado + telefone — também
 * conservador, para não colapsar estabelecimentos distintos.
 *
 * Função pura: recebe uma lista e devolve uma nova lista (não muta a entrada).
 */
import { createLead, extractPlaceId, onlyDigits } from "../domain/Lead.js";

/** Chave de deduplicação de um lead. */
function dedupeKey(lead) {
  const pid = extractPlaceId(lead.link_maps);
  if (pid) return `pid:${pid}`;
  const nome = (lead.nome || "").toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]/gu, "");
  return `nf:${nome}|${onlyDigits(lead.telefone)}`;
}

/** Preenche campos vazios de `base` com os valores de `extra`. */
function mergeLeads(base, extra) {
  const merged = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    const empty = merged[k] === "" || merged[k] === null || merged[k] === undefined;
    if (empty && v !== "" && v !== null && v !== undefined) merged[k] = v;
  }
  return merged;
}

/**
 * @param {Array<Record<string, any>>} rawLeads
 * @returns {import("../domain/Lead.js").Lead[]} leads normalizados, só sem duplicatas.
 */
export function cleanLeads(rawLeads = []) {
  const seen = new Map();

  for (const raw of rawLeads) {
    const lead = createLead(raw);
    const key = dedupeKey(lead);
    if (seen.has(key)) seen.set(key, mergeLeads(seen.get(key), lead));
    else seen.set(key, lead);
  }

  return [...seen.values()];
}
