/**
 * Caso de uso: FILTRO de leads por qualidade de reputação.
 *
 * Mantém apenas leads com quantidade de avaliações dentro de uma faixa e nota
 * mínima. Os limites têm padrões (5–100 avaliações, nota 4,0) mas são ajustáveis
 * pela interface.
 *
 * Leads sem reputação (sem nota / sem avaliações) só passam quando o mínimo de
 * avaliações é 0 — útil para incluir negócios novos que ainda não têm reviews.
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
    // Sem dados de reputação (empresa nova / sem reviews): só entram quando o
    // usuário zera o mínimo de avaliações — não dá para exigir estrelas de quem
    // não tem nota. Com mínimo > 0, continuam fora.
    if (aval === null || nota === null) return minAvaliacoes === 0;
    if (aval < minAvaliacoes || aval > maxAvaliacoes) return false;
    if (nota < notaMin) return false;
    return true;
  });
}
