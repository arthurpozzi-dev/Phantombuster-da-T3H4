/**
 * Caso de uso: FILTRO de leads por qualidade de reputação.
 *
 * Mantém apenas leads com quantidade de avaliações dentro de uma faixa e nota
 * mínima. Os limites têm padrões (5–100 avaliações, nota 4,0) mas são ajustáveis
 * pela interface.
 *
 * Função pura.
 */

/**
 * @typedef {Object} FilterOptions
 * @property {number} [minAvaliacoes=5]   mínimo de avaliações (inclusivo)
 * @property {number} [maxAvaliacoes=100] máximo de avaliações (inclusivo)
 * @property {number} [notaMin=4]         nota mínima (inclusiva)
 */

export const DEFAULT_FILTER = Object.freeze({
  minAvaliacoes: 5,
  maxAvaliacoes: 100,
  notaMin: 4,
});

/**
 * @param {import("../domain/Lead.js").Lead[]} leads
 * @param {FilterOptions} [options]
 * @returns {import("../domain/Lead.js").Lead[]}
 */
export function filterLeads(leads = [], options = {}) {
  const { minAvaliacoes, maxAvaliacoes, notaMin } = { ...DEFAULT_FILTER, ...options };

  return leads.filter((lead) => {
    const aval = lead.avaliacoes;
    const nota = lead.nota;
    if (aval === null || nota === null) return false; // sem dados de reputação
    if (aval < minAvaliacoes || aval > maxAvaliacoes) return false;
    if (nota < notaMin) return false;
    return true;
  });
}
