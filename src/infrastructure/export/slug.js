/**
 * Gera um "slug" seguro para nomes de arquivos/pastas (sem acento, sem
 * pontuação, em minúsculas).
 * @param {string} value
 * @param {string} [fallback="item"]
 * @returns {string}
 */
export function slugify(value, fallback = "item") {
  const s = (value || "")
    .toString()
    .replace(/https?:\/\/\S+/g, "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "") // remove acentos (marcas combinantes): "são" -> "sao"
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  return s || fallback;
}
