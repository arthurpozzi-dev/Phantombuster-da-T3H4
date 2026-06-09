/**
 * Exportador CSV. Usa ";" como separador (padrão PT-BR no Excel) e adiciona um
 * BOM no início para o Excel abrir os acentos corretamente.
 */

/** Escapa um valor para CSV. */
function esc(value) {
  const s = value === null || value === undefined ? "" : value.toString();
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * @param {Array<Record<string, any>>} rows
 * @param {{key: string, header: string}[]} columns
 * @returns {string} conteúdo CSV (com BOM).
 */
export function toCSV(rows, columns) {
  const header = columns.map((c) => c.header).join(";");
  const lines = rows.map((r) => columns.map((c) => esc(r[c.key])).join(";"));
  return "﻿" + [header, ...lines].join("\r\n");
}
