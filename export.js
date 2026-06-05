import ExcelJS from "exceljs";

// Ordem e rotulos das colunas da planilha.
export const COLUMNS = [
  { key: "nome", header: "Nome" },
  { key: "categoria", header: "Categoria" },
  { key: "nota", header: "Nota" },
  { key: "avaliacoes", header: "Avaliações" },
  { key: "telefone", header: "Telefone" },
  { key: "endereco", header: "Endereço" },
  { key: "site", header: "Site" },
  { key: "plus_code", header: "Plus Code" },
  { key: "link_maps", header: "Link Google Maps" },
];

/** Gera uma string CSV (com BOM para o Excel abrir acentos certo). */
export function toCSV(rows) {
  const esc = (v) => {
    const s = (v ?? "").toString();
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = COLUMNS.map((c) => c.header).join(";");
  const lines = rows.map((r) => COLUMNS.map((c) => esc(r[c.key])).join(";"));
  return "﻿" + [header, ...lines].join("\r\n");
}

/** Gera um buffer XLSX formatado. */
export async function toXLSX(rows) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Maps Leads Scraper";
  const ws = wb.addWorksheet("Leads");

  ws.columns = COLUMNS.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.key === "link_maps" || c.key === "endereco" ? 45 : 22,
  }));

  ws.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FF111111" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5FF00" } };
    cell.alignment = { vertical: "middle" };
  });
  ws.getRow(1).height = 22;

  rows.forEach((r) => ws.addRow(r));
  ws.autoFilter = { from: "A1", to: { row: 1, column: COLUMNS.length } };
  ws.views = [{ state: "frozen", ySplit: 1 }];

  return wb.xlsx.writeBuffer();
}
