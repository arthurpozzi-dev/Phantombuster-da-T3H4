/**
 * Monta o pacote de exportação (.zip): uma pasta por busca, com as planilhas
 * (com-site / sem-site) nos formatos e colunas escolhidos, e os relatórios dos
 * sites enriquecidos em HTML e/ou PDF.
 *
 * É configurável (ver `build`): o chamador decide listas, formatos, colunas e
 * relatórios. Os padrões reproduzem o comportamento antigo (ambas as listas em
 * CSV + relatórios HTML), então quem chamava `build(buscas)` continua igual.
 *
 * A coluna "Arquivo Relatório" de cada lead enriquecido é preenchida AQUI, no
 * momento da exportação, apontando para o arquivo correspondente dentro do ZIP.
 */
import JSZip from "jszip";

import { toCSV } from "./csvExporter.js";
import { toXLSX } from "./xlsxExporter.js";
import { pickColumns } from "./columns.js";
import { slugify } from "./slug.js";
import { getReportLocale } from "../../application/reportI18n/index.js";

export class ExportBundle {
  /**
   * @param {Object} deps
   * @param {import("../report/AuditReportRenderer.js").AuditReportRenderer} deps.reportRenderer
   */
  constructor({ reportRenderer }) {
    this.reportRenderer = reportRenderer;
  }

  /**
   * @param {Array<{ query:string, comSite:any[], semSite:any[] }>} buscas
   * @param {Object} [options]
   * @param {Array<"com-site"|"sem-site">} [options.lists=["com-site","sem-site"]] listas a exportar
   * @param {Array<"csv"|"xlsx">} [options.formats=["csv"]] formatos das planilhas
   * @param {{ "com-site"?: string[], "sem-site"?: string[] }} [options.columns] colunas por lista (vazio = todas)
   * @param {"none"|"html"|"pdf"|"both"} [options.reports="html"] relatórios a incluir
   * @param {{ render:(html:string)=>Promise<Buffer> }} [options.pdfRenderer] necessário p/ PDF
   * @param {string} [options.locale] idioma dos relatórios (ex.: "pt-BR", "en-US")
   * @param {boolean} [options.onlyWithEmail=false] exporta só leads com `site_emails` preenchido
   * @returns {Promise<{ buffer: Buffer, totalReports: number }>}
   */
  async build(buscas, options = {}) {
    const {
      lists = ["com-site", "sem-site"],
      formats = ["csv"],
      columns = null,
      reports = "html",
      pdfRenderer = null,
      locale = undefined,
      onlyWithEmail = false,
    } = options;

    const hasEmail = (lead) => String(lead.site_emails || "").trim() !== "";
    const keep = (rows) => (onlyWithEmail ? rows.filter(hasEmail) : rows);

    const wantHtml = reports === "html" || reports === "both";
    const wantPdf = (reports === "pdf" || reports === "both") && !!pdfRenderer;

    // Termos de nome de arquivo no idioma escolhido (pasta de relatórios,
    // prefixo do relatório, nomes das planilhas).
    const f = getReportLocale(locale).files;
    const reportsDir = f.reportsDir;

    const zip = new JSZip();
    const usedFolders = new Map();
    let totalReports = 0;

    for (const busca of buscas) {
      // Pasta única por busca.
      let folderName = slugify(busca.query, "busca");
      const fn = (usedFolders.get(folderName) || 0) + 1;
      usedFolders.set(folderName, fn);
      if (fn > 1) folderName = `${folderName}-${fn}`;
      const folder = zip.folder(folderName);

      // 1) Relatórios (HTML/PDF) e referência do arquivo em cada lead enriquecido.
      const usedFiles = new Map();
      const comSite = [];
      for (const lead of keep(busca.comSite)) {
        if (!lead.cwv_report || reports === "none") {
          comSite.push({ ...lead, relatorio_arquivo: "" });
          continue;
        }
        let base = `${f.reportPrefix}-${slugify(lead.nome, "lead")}`;
        const c = (usedFiles.get(base) || 0) + 1;
        usedFiles.set(base, c);
        if (c > 1) base = `${base}-${c}`;

        const html = this.reportRenderer.render(lead, { locale });
        let ref = "";
        if (wantHtml) {
          folder.file(`${reportsDir}/${base}.html`, html);
          ref = `${reportsDir}/${base}.html`;
        }
        if (wantPdf) {
          const pdf = await pdfRenderer.render(html);
          folder.file(`${reportsDir}/${base}.pdf`, pdf);
          if (!ref) ref = `${reportsDir}/${base}.pdf`;
        }
        totalReports++;
        comSite.push({ ...lead, relatorio_arquivo: ref });
      }

      // 2) Planilhas, nos formatos e colunas escolhidos.
      const rowsByList = { "com-site": comSite, "sem-site": keep(busca.semSite) };
      for (const list of lists) {
        const rows = rowsByList[list];
        if (!rows) continue;
        const cols = pickColumns(list, columns?.[list]);
        const { file: listFile, label: listLabel } = f.list[list];
        if (formats.includes("csv")) folder.file(`${listFile}.csv`, toCSV(rows, cols));
        if (formats.includes("xlsx")) {
          const buf = await toXLSX(rows, cols, listLabel);
          folder.file(`${listFile}.xlsx`, Buffer.from(buf));
        }
      }
    }

    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    return { buffer, totalReports };
  }
}
