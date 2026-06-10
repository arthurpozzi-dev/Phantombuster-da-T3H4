/**
 * Renderiza o HTML do relatório de auditoria em PDF, via Playwright/Chromium.
 *
 * O template (`audit-template.html`) depende de recursos externos (Tailwind CDN,
 * Iconify, Google Fonts) que só produzem o layout final depois de carregar e
 * executar. Por isso esperamos a rede ficar ociosa e damos um instante extra
 * para o Tailwind aplicar os estilos antes de imprimir. Imprimimos com a mídia
 * "screen" + fundo, para o PDF sair igual à versão que aparece na tela.
 *
 * Ciclo de vida: o navegador sobe sob demanda e deve ser fechado com `close()`
 * ao fim do lote. Uma instância por requisição evita que uma feche o navegador
 * que a outra ainda usa.
 */
import { chromium } from "playwright";
import { buildLaunchOptions } from "../scraper/GoogleMapsScraper.js";

export class PdfRenderer {
  /**
   * @param {Object} [options]
   * @param {boolean} [options.headless=true]
   * @param {number} [options.settleMs=600] espera após a rede ociosa (Tailwind aplicar)
   * @param {number} [options.pageWidth=900] largura (px) da página única do PDF
   */
  constructor({ headless = true, settleMs = 600, pageWidth = 900 } = {}) {
    this.headless = headless;
    this.settleMs = settleMs;
    this.pageWidth = pageWidth;
    this.browser = null;
    this.launching = null;
  }

  /** Sobe o Chromium uma única vez (seguro sob concorrência). */
  async #launch() {
    if (this.browser) return this.browser;
    if (!this.launching) this.launching = chromium.launch(buildLaunchOptions(this.headless));
    this.browser = await this.launching;
    return this.browser;
  }

  /** Fecha o navegador, se aberto. Idempotente. */
  async close() {
    const b = this.browser;
    this.browser = null;
    this.launching = null;
    if (b) await b.close().catch(() => {});
  }

  /**
   * Converte o HTML de um relatório em um Buffer PDF de UMA única página, com a
   * altura exata do conteúdo (sem quebras que cortam informação e sem sobra
   * branca nas bordas).
   * @param {string} html
   * @returns {Promise<Buffer>}
   */
  async render(html) {
    await this.#launch();
    const page = await this.browser.newPage({ viewport: { width: this.pageWidth, height: 1200 } });
    try {
      await page.setContent(html, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
      await page.emulateMedia({ media: "screen" });

      // Otimização de peso/desempenho do PDF:
      //  - esconde o fundo decorativo (.grid-bg): é um elemento fixo de tela
      //    inteira com máscara radial que, numa página longa, vira um soft-mask
      //    gigante rasterizado — a principal causa de PDF pesado e rolagem lenta;
      //  - congela transições/animações para o anel de score sair no valor final
      //    (sem capturar o meio da animação) e sem custo de render.
      await page.addStyleTag({
        content: `
          .grid-bg { display: none !important; }
          *, *::before, *::after {
            transition: none !important; animation: none !important;
            -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;
          }
        `,
      });

      await page.waitForTimeout(this.settleMs);

      // Altura real do conteúdo já renderizado (inclui tudo que rolaria na tela).
      const height = await page.evaluate(() => {
        const d = document.documentElement;
        const b = document.body;
        return Math.ceil(Math.max(d.scrollHeight, b.scrollHeight, d.offsetHeight, b.offsetHeight));
      });

      return await page.pdf({
        width: `${this.pageWidth}px`,
        height: `${height + 2}px`, // +2px de folga p/ não cortar a última linha
        printBackground: true,
        margin: { top: "0", right: "0", bottom: "0", left: "0" },
        pageRanges: "1", // garante página única, mesmo se algo recalcular o layout
      });
    } finally {
      await page.close().catch(() => {});
    }
  }
}
