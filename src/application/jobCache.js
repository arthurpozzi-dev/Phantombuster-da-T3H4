/**
 * Cache/dedup POR JOB do enriquecimento. Cada memoizador guarda a PROMESSA em voo
 * por chave (não só o valor resolvido), de modo que leads concorrentes que batem
 * na mesma chave compartilham a MESMA operação de rede. Rejeição limpa a entrada
 * (falha não fica cacheada); sucesso permanece pelo tempo de vida do job.
 *
 * Escopo: um job (uma execução). Vive no store do servidor e some com o job.
 *
 * DESIGN TRADE-OFF: Leads do mesmo domínio compartilham o mesmo destino em caso de
 * falha transiente — se a rede falhar, todos falham juntos (por design; o cache
 * evicta em rejeição para permitir retry em reconexões posteriores).
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

/**
 * Cache de CWV PERSISTENTE entre jobs, por domínio, com TTL. Diferente do memo
 * por job (que só dedup chamadas em voo dentro de uma execução), este RETÉM o
 * valor resolvido por `ttlMs` — CWV varia devagar, então reanalisar o mesmo
 * domínio em minutos/horas é desperdício (cada análise de laboratório custa
 * ~20s). Combina o dedup de promessas em voo com a retenção do resultado.
 *
 * A chave já deve embutir o que muda o resultado (deep/fast, estratégia) — ver
 * EnrichLeads. Rejeição NÃO fica cacheada (evicta para permitir retry depois).
 *
 * @param {{ ttlMs?: number, now?: () => number }} [opts]
 */
export function createCwvCache({ ttlMs = 6 * 3600_000, now = () => Date.now() } = {}) {
  const inflight = new Map();
  const resolved = new Map(); // key -> { value, at }
  return {
    run(key, factory) {
      const k = key || "";
      const hit = resolved.get(k);
      if (hit) {
        if (now() - hit.at < ttlMs) return Promise.resolve(hit.value);
        resolved.delete(k); // expirado: evicta (senão a entrada fria nunca sai e vaza memória)
      }
      if (inflight.has(k)) return inflight.get(k);
      const p = Promise.resolve()
        .then(factory)
        .then((value) => {
          resolved.set(k, { value, at: now() });
          inflight.delete(k);
          return value;
        })
        .catch((e) => {
          inflight.delete(k);
          throw e;
        });
      inflight.set(k, p);
      return p;
    },
    /**
     * Remove todas as entradas expiradas. O `run()` só evicta a chave que é
     * relida; domínios analisados uma vez e nunca mais ficariam para sempre —
     * por isso o servidor chama isto periodicamente.
     */
    sweep() {
      const t = now();
      for (const [k, v] of resolved) if (t - v.at >= ttlMs) resolved.delete(k);
    },
  };
}
