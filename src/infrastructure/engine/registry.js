/**
 * Registry de engines: resolve um Engine por nome (e modo, no caso do Scrapling),
 * com cache por instância. Nome desconhecido cai no Playwright (comportamento
 * padrão do projeto). A instanciação é preguiçosa — só cria o engine pedido.
 */
import { PlaywrightEngine } from "./PlaywrightEngine.js";
import { CloakBrowserEngine } from "./CloakBrowserEngine.js";
import { ScraplingEngine } from "./ScraplingEngine.js";

export function createEngineRegistry() {
  const cache = new Map();

  function get(name, opts = {}) {
    if (name === "cloakbrowser") {
      if (!cache.has("cloakbrowser")) cache.set("cloakbrowser", new CloakBrowserEngine());
      return cache.get("cloakbrowser");
    }
    if (name === "scrapling") {
      const mode = opts.mode || "fast";
      const key = `scrapling:${mode}`;
      if (!cache.has(key)) cache.set(key, new ScraplingEngine({ mode }));
      return cache.get(key);
    }
    // padrão / desconhecido -> playwright
    if (!cache.has("playwright")) cache.set("playwright", new PlaywrightEngine());
    return cache.get("playwright");
  }

  async function closeAll() {
    for (const e of cache.values()) {
      try { await e.close(); } catch { /* best-effort */ }
    }
    cache.clear();
  }

  return { get, closeAll };
}
