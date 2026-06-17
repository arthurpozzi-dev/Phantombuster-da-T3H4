/**
 * Engine padrão: Playwright/Chromium (comportamento atual do projeto).
 *
 *  - fetchHtml: fetch nativo do Node (HTTP simples).
 *  - launchBrowser: chromium.launch com as opções por SO (buildLaunchOptions).
 */
import { chromium } from "playwright";
import { buildLaunchOptions } from "./launchOptions.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export class PlaywrightEngine {
  /** @param {{ fetchImpl?: typeof fetch }} [options] */
  constructor({ fetchImpl } = {}) {
    this.name = "playwright";
    this.supportsBrowser = true;
    this._fetch = fetchImpl || globalThis.fetch;
  }

  async fetchHtml(url, { timeoutMs = 15000, headers = {} } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await this._fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
          ...headers,
        },
      });
      const html = await res.text();
      return { html, status: res.status, finalUrl: res.url || url };
    } finally {
      clearTimeout(timer);
    }
  }

  async launchBrowser({ headless = true } = {}) {
    return chromium.launch(buildLaunchOptions(headless));
  }

  async close() {}
}
