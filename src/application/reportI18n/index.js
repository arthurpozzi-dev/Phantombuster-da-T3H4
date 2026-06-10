/**
 * Internacionalização (i18n) do relatório de auditoria.
 *
 * Cada locale é um módulo com metadados de formatação (`htmlLang`, `localeCode`,
 * `decimal`) e uma função `strings(ctx)` que devolve TODOS os textos do relatório
 * já resolvidos para aquele idioma — inclusive a prosa persuasiva, que varia
 * conforme o contexto (faixa de nota, situação de cada métrica). A lógica de
 * cálculo (faixas, score, formatação) fica no caso de uso buildAuditReportModel;
 * aqui mora só o conteúdo traduzido.
 */
import ptBR from "./pt-BR.js";
import enUS from "./en-US.js";
import ptPT from "./pt-PT.js";
import es from "./es.js";

const LOCALES = { "pt-BR": ptBR, "en-US": enUS, "pt-PT": ptPT, es };

export const DEFAULT_LOCALE = "pt-BR";
export const SUPPORTED_LOCALES = Object.keys(LOCALES);

/** Devolve o módulo do locale pedido, caindo no padrão se não existir. */
export function getReportLocale(locale) {
  return LOCALES[locale] || LOCALES[DEFAULT_LOCALE];
}
