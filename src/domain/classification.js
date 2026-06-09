/**
 * Regras de classificação puras do domínio.
 *
 * Não dependem de I/O nem de framework. Aqui ficam as listas de domínios que
 * NÃO devem ser tratados como "site próprio" do estabelecimento e os limites
 * (thresholds) usados para classificar a performance do site (Core Web Vitals).
 */

/**
 * Domínios de redes sociais e agregadores de links.
 *
 * Muitos estabelecimentos cadastram um Instagram, Facebook ou um Linktree no
 * campo "site" do Google Maps. Para o nosso fluxo, isso NÃO conta como site
 * próprio — esses leads vão para a lista "sem site" e o link é guardado em
 * `redes_sociais`.
 */
export const SOCIAL_DOMAINS = [
  "instagram.com",
  "facebook.com",
  "fb.com",
  "fb.me",
  "m.facebook.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "youtube.com",
  "youtu.be",
  "linkedin.com",
  "wa.me",
  "whatsapp.com",
  "api.whatsapp.com",
  "t.me",
  "telegram.me",
  "telegram.org",
  // Agregadores de links ("link na bio")
  "linktr.ee",
  "linktree.com",
  "bio.link",
  "beacons.ai",
  "campsite.bio",
  "linkr.bio",
  "lnk.bio",
  "many.link",
  "msha.ke",
  "linkin.bio",
];

/**
 * Limites de classificação do Core Web Vitals (faixas padrão do Lighthouse).
 * Score de performance vai de 0 a 100.
 */
export const CWV_THRESHOLDS = {
  BOM: 90, // score >= 90  -> "BOM"
  MEDIO: 50, // 50 <= score < 90 -> "MÉDIO"; abaixo de 50 -> "RUIM"
};

/**
 * Extrai o hostname (em minúsculas, sem "www.") de uma URL.
 * @param {string} url
 * @returns {string} hostname ou "" se a URL for inválida.
 */
export function getHostname(url) {
  if (!url) return "";
  try {
    const withProtocol = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return new URL(withProtocol).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Diz se uma URL aponta para uma rede social ou agregador de links
 * (ou seja, NÃO é um site próprio do estabelecimento).
 * @param {string} url
 * @returns {boolean}
 */
export function isSocialOrAggregator(url) {
  const host = getHostname(url);
  if (!host) return false;
  return SOCIAL_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * Classifica um score de performance (0–100) em RUIM / MÉDIO / BOM.
 * @param {number} score
 * @returns {"RUIM"|"MÉDIO"|"BOM"}
 */
export function classifyCwv(score) {
  if (score >= CWV_THRESHOLDS.BOM) return "BOM";
  if (score >= CWV_THRESHOLDS.MEDIO) return "MÉDIO";
  return "RUIM";
}
