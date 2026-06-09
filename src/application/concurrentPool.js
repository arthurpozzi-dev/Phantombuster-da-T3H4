/**
 * Pool de concorrência simples e genérico.
 *
 * Processa uma lista executando até `concurrency` tarefas ao mesmo tempo,
 * preservando a ordem dos resultados. Usado tanto pelo enriquecimento
 * (PageSpeed) quanto pelo scraping de texto dos sites — ambos são operações
 * lentas de rede que se beneficiam de paralelismo limitado.
 *
 * Função pura quanto a controle de fluxo (o I/O fica dentro de `task`).
 */

/**
 * @template T, R
 * @param {T[]} items
 * @param {Object} options
 * @param {number} [options.concurrency=8]
 * @param {(item: T, index: number) => Promise<R>} options.task   executa um item
 * @param {(done: number, total: number, item: T, result: R) => void} [options.onDone]
 * @returns {Promise<R[]>} resultados na mesma ordem de `items`.
 */
export async function runPool(items, { concurrency = 8, task, onDone }) {
  const total = items.length;
  const results = new Array(total);
  let next = 0;
  let done = 0;

  async function worker() {
    while (next < total) {
      const i = next++;
      const r = await task(items[i], i);
      results[i] = r;
      onDone?.(++done, total, items[i], r);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, total) || 0 }, worker);
  await Promise.all(workers);
  return results;
}
