/**
 * Monta o pacote de exportação (.zip): uma pasta por busca, cada uma com as
 * planilhas (com-site / sem-site, em CSV e XLSX) e os relatórios HTML dos sites
 * enriquecidos.
 *
 * A coluna "Arquivo Relatório" de cada lead enriquecido é preenchida AQUI, no
 * momento da exportação, apontando para o HTML correspondente dentro do ZIP —
 * garantindo que a referência na planilha bata com o arquivo gerado.
 */
import JSZip from "jszip";

import { toCSV } from "./csvExporter.js";
import { columnsFor } from "./columns.js";
import { slugify } from "./slug.js";
import { AuditReportRenderer } from "../report/AuditReportRenderer.js";

const REPORTS_DIR = "relatorios";

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
   * @returns {Promise<{ buffer: Buffer, totalReports: number }>}
   */
  async build(buscas) {
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

      // 1) Gera relatórios e marca o arquivo de cada lead enriquecido.
      const usedFiles = new Map();
      const comSite = busca.comSite.map((lead) => {
        if (!lead.cwv_report) return { ...lead, relatorio_arquivo: "" };
        let file = AuditReportRenderer.fileName(lead.nome);
        const c = (usedFiles.get(file) || 0) + 1;
        usedFiles.set(file, c);
        if (c > 1) file = file.replace(/\.html$/, `-${c}.html`);
        folder.file(`${REPORTS_DIR}/${file}`, this.reportRenderer.render(lead));
        totalReports++;
        return { ...lead, relatorio_arquivo: `${REPORTS_DIR}/${file}` };
      });

      // 2) Planilhas em CSV (com a coluna "Arquivo Relatório" já preenchida).
      const colCom = columnsFor("com-site");
      const colSem = columnsFor("sem-site");
      folder.file("com-site.csv", toCSV(comSite, colCom));
      folder.file("sem-site.csv", toCSV(busca.semSite, colSem));
    }

    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    return { buffer, totalReports };
  }
}
