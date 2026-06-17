/**
 * Cache/dedup POR JOB do enriquecimento. Cada memoizador guarda a PROMESSA em voo
 * por chave (não só o valor resolvido), de modo que leads concorrentes que batem
 * na mesma chave compartilham a MESMA operação de rede. Rejeição limpa a entrada
 * (falha não fica cacheada); sucesso permanece pelo tempo de vida do job.
 *
 * Escopo: um job (uma execução). Vive no store do servidor e some com o job.
 */

/** Normaliza uma URL para servir de chave: protocolo, host minúsculo, sem barra/fragmento final. */
export function cacheKey(url) {
  const raw = (url || "").trim();
  if (!raw) return "";
  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withProto);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    const s = u.toString();
    return s.endsWith("/") ? s.slice(0, -1) : s;
  } catch {
    return raw.toLowerCase();
  }
}

/** Um memoizador de promessas por chave. */
function createMemo() {
  const inflight = new Map();
  return {
    run(key, factory) {
      const k = key || "";
      if (inflight.has(k)) return inflight.get(k);
      const p = Promise.resolve().then(factory).catch((e) => {
        inflight.delete(k);
        throw e;
      });
      inflight.set(k, p);
      return p;
    },
  };
}

/** Cria o cache de um job com os três namespaces usados no enriquecimento. */
export function createJobCache() {
  return { page: createMemo(), search: createMemo(), cwv: createMemo() };
}
