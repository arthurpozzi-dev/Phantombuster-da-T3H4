/**
 * Definição das colunas das planilhas exportadas.
 *
 * Há dois conjuntos: a lista "sem site" e a lista "com site" (que inclui as
 * colunas de Core Web Vitals geradas no enriquecimento).
 */

/** Colunas comuns às duas listas. */
const BASE_COLUMNS = [
  { key: "nome", header: "Nome" },
  { key: "categoria", header: "Categoria" },
  { key: "nota", header: "Avaliação" },
  { key: "avaliacoes", header: "Qtd. Avaliações" },
  { key: "telefone", header: "Telefone" },
  { key: "whatsapp", header: "WhatsApp" },
  { key: "redes_sociais", header: "Redes Sociais" },
  { key: "descricao", header: "Descrição" },
  { key: "link_maps", header: "Link Google Maps" },
];

/** Lista "sem site": colunas base (sem a coluna de site). */
export const COLUMNS_SEM_SITE = BASE_COLUMNS;

/** Lista "com site": inclui Site + relatório detalhado de Core Web Vitals. */
export const COLUMNS_COM_SITE = [
  ...BASE_COLUMNS.slice(0, 6), // até WhatsApp
  { key: "site", header: "Site" },
  { key: "redes_sociais", header: "Redes Sociais" },
  // Performance (headline)
  { key: "cwv_score", header: "Performance" },
  { key: "cwv_status", header: "Status" },
  // Métricas de laboratório (Core Web Vitals e afins)
  { key: "cwv_lcp", header: "LCP" },
  { key: "cwv_fcp", header: "FCP" },
  { key: "cwv_cls", header: "CLS" },
  { key: "cwv_tbt", header: "TBT" },
  { key: "cwv_si", header: "Speed Index" },
  { key: "cwv_tti", header: "TTI" },
  // Demais categorias do Lighthouse
  { key: "score_acessibilidade", header: "Acessibilidade" },
  { key: "score_boas_praticas", header: "Boas Práticas" },
  { key: "score_seo", header: "SEO" },
  // Dados derivados do relatório do PageSpeed
  { key: "audit_score", header: "Nota Auditoria (/10)" },
  { key: "cwv_campo", header: "CrUX (campo)" },
  { key: "cwv_oportunidades", header: "Oportunidades (PageSpeed)" },
  // Conteúdo do site e referência ao relatório exportado
  { key: "site_emails", header: "E-mails" },
  { key: "site_texto", header: "Texto do Site" },
  { key: "relatorio_arquivo", header: "Arquivo Relatório" },
  { key: "descricao", header: "Descrição" },
  { key: "link_maps", header: "Link Google Maps" },
];

/**
 * Devolve o conjunto de colunas para a lista pedida.
 * @param {"com-site"|"sem-site"} list
 * @returns {{key: string, header: string}[]}
 */
export function columnsFor(list) {
  return list === "com-site" ? COLUMNS_COM_SITE : COLUMNS_SEM_SITE;
}

/**
 * Filtra as colunas de uma lista mantendo só as chaves pedidas (na ordem
 * canônica). Chaves vazias/ausentes => todas as colunas. Chaves desconhecidas
 * são ignoradas.
 * @param {"com-site"|"sem-site"} list
 * @param {string[]} [keys]
 * @returns {{key: string, header: string}[]}
 */
export function pickColumns(list, keys) {
  const all = columnsFor(list);
  if (!Array.isArray(keys) || !keys.length) return all;
  const wanted = new Set(keys);
  const picked = all.filter((c) => wanted.has(c.key));
  return picked.length ? picked : all;
}
