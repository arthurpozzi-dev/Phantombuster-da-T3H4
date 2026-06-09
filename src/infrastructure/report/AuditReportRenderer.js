/**
 * Renderizador do relatório de auditoria (HTML).
 *
 * Carrega o template (`audit-template.html`), injeta o modelo persuasivo
 * produzido por `buildAuditReportModel` e devolve o HTML final. Também monta um
 * ZIP com um relatório por lead (para o botão "gerar todos de uma vez").
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildAuditReportModel } from "../../application/buildAuditReportModel.js";
import { slugify } from "../export/slug.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "audit-template.html");

/** Aplica o modelo de placeholders no template ({{CHAVE}} -> valor). */
function fillTemplate(template, model) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(model, key) ? model[key] : match
  );
}

export class AuditReportRenderer {
  /**
   * @param {Object} [options]
   * @param {string} [options.ctaUrl] link do botão "ver versão reconstruída".
   */
  constructor({ ctaUrl } = {}) {
    this.template = readFileSync(TEMPLATE_PATH, "utf-8");
    this.ctaUrl = ctaUrl || process.env.REPORT_CTA_URL || "https://t3h4.com.br";
  }

  /**
   * Renderiza o HTML do relatório de um lead enriquecido.
   * @param {import("../../domain/Lead.js").Lead & { cwv_report?: any }} lead
   * @returns {string} HTML completo.
   */
  render(lead) {
    const model = buildAuditReportModel(lead, { ctaUrl: this.ctaUrl });
    return fillTemplate(this.template, model);
  }

  /** Nome-base do arquivo HTML do relatório de um lead (sem deduplicação). */
  static fileName(nome) {
    return `relatorio-${slugify(nome, "lead")}.html`;
  }
}
