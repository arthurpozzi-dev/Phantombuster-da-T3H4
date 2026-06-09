/**
 * Entidade de domínio: Lead (um estabelecimento coletado do Google Maps).
 *
 * Este módulo contém SÓ regras puras: normalização de texto, parse de números
 * (nota/avaliações), formatação de telefone e geração do link de WhatsApp.
 * Nada aqui faz I/O (nem rede, nem disco, nem browser).
 */

/** Colapsa espaços e remove pontas em branco. */
export const clean = (s) => (s || "").toString().replace(/\s+/g, " ").trim();

/**
 * Converte a nota textual ("4,7" / "4.7") em número.
 * @param {string|number} value
 * @returns {number|null} a nota (ex.: 4.7) ou null se não houver.
 */
export function parseRating(value) {
  if (typeof value === "number") return value;
  const m = clean(value).match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Converte a quantidade de avaliações ("(1.234)" / "1,234" / "98") em número
 * inteiro. Lida com separador de milhar PT-BR (ponto) e EN (vírgula).
 * @param {string|number} value
 * @returns {number|null}
 */
export function parseReviews(value) {
  if (typeof value === "number") return value;
  const digits = clean(value).replace(/[^\d]/g, "");
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Mantém apenas dígitos de um telefone.
 * @param {string} phone
 * @returns {string}
 */
export function onlyDigits(phone) {
  return clean(phone).replace(/\D/g, "");
}

/**
 * Gera o link de WhatsApp (wa.me) a partir de um telefone brasileiro, QUANDO
 * ele for um celular (DDD + 9 dígitos começando em 9).
 *
 * Heurística: o Google Maps não informa se um número tem WhatsApp. Assumimos
 * que celulares têm. Telefones fixos retornam "".
 *
 * @param {string} phone telefone em qualquer formato
 * @returns {string} URL https://wa.me/55XXXXXXXXXXX ou "".
 */
export function toWhatsAppLink(phone) {
  let d = onlyDigits(phone);
  if (!d) return "";
  // Remove o código do país, se já vier com 55.
  if (d.length === 13 && d.startsWith("55")) d = d.slice(2);
  if (d.length === 12 && d.startsWith("55")) d = d.slice(2); // fixo com DDI
  // Celular BR: 11 dígitos (2 do DDD + 9 + 8). O primeiro do número é 9.
  const isMobile = d.length === 11 && d[2] === "9";
  if (!isMobile) return "";
  return `https://wa.me/55${d}`;
}

/**
 * Formata um telefone BR para exibição: (16) 99999-9999 ou (16) 3333-4444.
 * Se não casar com o padrão, devolve o original limpo.
 * @param {string} phone
 * @returns {string}
 */
export function formatPhone(phone) {
  const d = onlyDigits(phone);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return clean(phone);
}

/**
 * @typedef {Object} Lead
 * @property {string} nome
 * @property {string} categoria
 * @property {number|null} nota             Avaliação (ex.: 4.7)
 * @property {number|null} avaliacoes       Quantidade de avaliações
 * @property {string} telefone              Telefone formatado
 * @property {string} whatsapp              Link wa.me (se celular)
 * @property {string} site                  Site próprio (preenchido após a separação)
 * @property {string} site_bruto            Link cru do campo "site" do Maps (candidato)
 * @property {string} redes_sociais         Links de redes sociais / agregadores (separados por " | ")
 * @property {string} link_maps             Link do Google Maps / Meu Negócio
 * @property {string} descricao             Descrição, se houver
 * @property {number|null} cwv_score        Pontuação Core Web Vitals (0–100), pós-enriquecimento
 * @property {string} cwv_status            RUIM / MÉDIO / BOM / N/A, pós-enriquecimento
 */

/**
 * Cria um Lead normalizado a partir de dados crus extraídos do scraper.
 * Garante que todos os campos existam e tenham o tipo correto.
 * @param {Partial<Lead> & Record<string, any>} raw
 * @returns {Lead}
 */
export function createLead(raw = {}) {
  const telefoneFmt = formatPhone(raw.telefone);
  return {
    nome: clean(raw.nome),
    categoria: clean(raw.categoria),
    nota: typeof raw.nota === "number" ? raw.nota : parseRating(raw.nota),
    avaliacoes:
      typeof raw.avaliacoes === "number" ? raw.avaliacoes : parseReviews(raw.avaliacoes),
    telefone: telefoneFmt,
    whatsapp: clean(raw.whatsapp) || toWhatsAppLink(telefoneFmt),
    site: clean(raw.site),
    site_bruto: clean(raw.site_bruto || raw.site),
    redes_sociais: clean(raw.redes_sociais),
    link_maps: clean(raw.link_maps),
    descricao: clean(raw.descricao),
    cwv_score: typeof raw.cwv_score === "number" ? raw.cwv_score : null,
    cwv_status: clean(raw.cwv_status),
  };
}

/**
 * Indica se um Lead tem algum dado de contato útil (telefone, site/redes ou link do Maps).
 * Usado pela limpeza para descartar leads "vazios".
 * @param {Lead} lead
 * @returns {boolean}
 */
export function hasUsefulContact(lead) {
  return Boolean(
    lead.telefone || lead.site_bruto || lead.redes_sociais || lead.link_maps
  );
}
