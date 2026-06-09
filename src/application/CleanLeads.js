/**
 * Caso de uso: LIMPEZA da lista de leads.
 *
 * - Normaliza cada lead (via createLead).
 * - Descarta leads sem nome ou sem nenhum contato útil.
 * - Junta duplicatas, mesclando campos vazios de um com os preenchidos do outro.
 *
 * Função pura: recebe uma lista e devolve uma nova lista (não muta a entrada).
 */
import { createLead, hasUsefulContact } from "../domain/Lead.js";

/**
 * Gera a chave de deduplicação de um lead.
 * Prioriza o link do Maps (único por estabelecimento); se faltar, usa
 * nome normalizado + telefone (só dígitos).
 * @param {import("../domain/Lead.js").Lead} lead
 * @returns {string}
 */
function dedupeKey(lead) {
  // Deduplicação pelo NOME do lugar (normalizado). Não usamos o link do Maps
  // porque o Google gera URLs diferentes para o mesmo estabelecimento
  // (coordenadas/parâmetros variam), o que deixava duplicatas passarem.
  return normalizeName(lead.nome);
}

/** Normaliza o nome para comparação: minúsculas, sem acento e sem pontuação/espaços. */
function normalizeName(nome) {
  return (nome || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]/gu, "");
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
 * @returns {import("../domain/Lead.js").Lead[]} leads normalizados, sem vazios e sem duplicatas.
 */
export function cleanLeads(rawLeads = []) {
  const seen = new Map();

  for (const raw of rawLeads) {
    const lead = createLead(raw);
    if (!lead.nome || !hasUsefulContact(lead)) continue; // descarta vazio/inútil

    const key = dedupeKey(lead);
    if (seen.has(key)) {
      seen.set(key, mergeLeads(seen.get(key), lead));
    } else {
      seen.set(key, lead);
    }
  }

  return [...seen.values()];
}
