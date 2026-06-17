# Design — Engines de scraping selecionáveis + aceleração do CWV

Data: 2026-06-17
Status: proposta (aguardando revisão)

## 1. Objetivo

Dois workstreams independentes:

1. **Engines selecionáveis na UI.** Hoje o scraping usa Playwright fixo. Adicionar
   **CloakBrowser** (anti-ban) e **Scrapling** (rápido/stealth) como engines, com o
   usuário escolhendo na UI qual rodar — tanto no scrape do Google Maps quanto na
   camada de enriquecimento de sites de terceiros.
2. **Acelerar o enriquecimento CWV ao máximo** (aceitando alguns tradeoffs),
   mantendo número oficial quando necessário: estratégia mista CrUX-first +
   Lighthouse sob demanda.

## 2. Contexto atual (resumo do código)

- Composition root: `src/main.js` instancia e injeta todos os scrapers em `createServer`.
- Engines de browser hoje (Playwright): `GoogleMapsScraper` (scrape do Maps),
  `BrowserEmailScraper` (fallback JS para e-mails/sociais), `PdfRenderer` (relatório).
- Camada de **fetch** (HTTP puro, sem browser): `EmailScraper`, `SiteTextScraper`,
  `SiteHealthChecker`, e o endpoint `pb=` JSON do `GoogleMapsGridScraper`.
- CWV: `PageSpeedClient` chama PSI v5 com **4 categorias**, timeout 90s, conc 8
  (`EnrichLeads.js`). `enrichLeads` roda **Lighthouse completo em todo lead** e
  guarda o `cwv_report` inteiro; antes de medir roda um healthcheck serial de 12s.
- Contrato do scraper de Maps: `scrape({ input, maxResults, deep, onProgress }) ->
  Lead[]` (10 campos: nome, categoria, nota, avaliacoes, telefone, endereco,
  site_bruto, redes_sociais, descricao, link_maps).

## 3. Workstream 1 — Engines selecionáveis

### 3.1 Achado-chave: os engines têm formatos de integração diferentes

| Engine | Linguagem | Entrega ao Node | Integração |
|---|---|---|---|
| Playwright (atual) | Node | `Browser` ao vivo | nativo |
| **CloakBrowser** | Node (npm `cloakbrowser`) | **`Browser` do Playwright** (drop-in) | `chromium.launch()` → `cloakbrowser.launch()` |
| **Scrapling** | Python (sidecar HTTP) | HTML/JSON parseado | "fetch+parse", **não** dá Browser ao vivo |

- CloakBrowser: Chromium stealth com 58 patches no C++ (passa Cloudflare Turnstile,
  FingerprintJS, `navigator.webdriver=false`). Requer Node≥20 + `playwright-core`≥1.53
  (projeto está em playwright 1.61 ✓). Binário ~200MB auto-baixado em `~/.cloakbrowser/`.
- Scrapling: 3 fetchers — `Fetcher` (HTTP + impersonação TLS/HTTP3), `DynamicFetcher`
  (Playwright Chromium), `StealthyFetcher` (Camoufox, resolve Cloudflare).

### 3.2 Abordagem escolhida: B (CloakBrowser drop-in em tudo; Scrapling na camada de fetch)

Maior valor-por-esforço. CloakBrowser substitui Playwright em qualquer ponto
browser-based; Scrapling cobre a camada de fetch HTTP (onde mora o volume e o risco
de ban) com os 3 modos. Caminho para a abordagem A (Scrapling também no Maps
interativo) fica documentado como evolução futura, não entra na v1.

### 3.3 Abstração `Engine` (interface com 2 capacidades)

Novo módulo `src/infrastructure/engine/`:

```
Engine {
  name: "playwright" | "cloakbrowser" | "scrapling"
  // Camada HTTP — emails, sitetext, health, pb-endpoint:
  fetchHtml(url, { timeoutMs, headers, mode? }) -> { html, status, finalUrl }
  // Navegação ao vivo — Maps deep-scrape, email JS-fallback:
  launchBrowser({ headless }) -> Playwright.Browser     // pode lançar NotSupported
  supportsBrowser: boolean
  close()                                                 // libera recursos do engine
}
```

Implementações:

- **`PlaywrightEngine`** — `fetchHtml` via `fetch` do Node (comportamento atual);
  `launchBrowser` via `chromium.launch(buildLaunchOptions(headless))`. `supportsBrowser=true`.
- **`CloakBrowserEngine`** — `launchBrowser` via `cloakbrowser.launch({ headless,
  args })`; `fetchHtml` via uma página stealth (navega e retorna `content()`).
  `supportsBrowser=true`. Carregamento via `import("cloakbrowser")` lazy (só quando
  selecionado), para não pagar o custo do binário quando não usado.
- **`ScraplingEngine`** — `fetchHtml` chama o sidecar Python (`mode` ∈
  `fast`/`dynamic`/`stealth`); `launchBrowser` lança `NotSupported` →
  `supportsBrowser=false`. Quando Scrapling é escolhido para um passo que exige
  browser ao vivo (Maps deep-scrape), o servidor degrada para o caminho de fetch
  (`pb=` endpoint com stealth) e avisa na UI.

`buildLaunchOptions(headless)` é extraído de `GoogleMapsScraper.js` para um util
compartilhado (`engine/launchOptions.js`), reusado por Playwright e como base do Cloak.

### 3.4 Scrapling sidecar

- Pasta `scrapling-sidecar/` (FastAPI + uvicorn). Endpoint
  `POST /fetch { url, mode, timeout, network_idle? } -> { html, status, final_url }`.
  `GET /health`.
- Ciclo de vida: o `ScraplingEngine` **auto-sobe** o sidecar via `child_process` na
  primeira requisição Scrapling (porta local fixa, ex. 8765), faz health-check com
  retry, e o mantém vivo (reuso). Encerra no `close()`/shutdown do servidor.
- Pré-requisito de ambiente: Python ≥3.10 + `pip install "scrapling[fetchers]"` +
  `scrapling install` (browsers). Documentado no README; o engine detecta ausência
  e devolve erro claro na UI ("Scrapling não instalado — rode X").

### 3.5 Refatoração dos consumidores (injeção do engine)

- `GoogleMapsScraper` deixa de importar `chromium`; recebe `engine` e usa
  `engine.launchBrowser()`. Mantém todo o resto (scroll, extração, deep-load).
- `BrowserEmailScraper` idem (`engine.launchBrowser()`).
- `EmailScraper`, `SiteTextScraper`, `SiteHealthChecker` passam a usar
  `engine.fetchHtml()` no lugar do `fetch` cru.
- `main.js` cria um **registry de engines** `{ playwright, cloakbrowser, scrapling }`
  e uma função `getEngine(name)`; injeta no `createServer`.

### 3.6 Wiring UI → servidor → engine

- `public/index.html`: novo `<select id="engine">` (Playwright / CloakBrowser /
  Scrapling) + `<select id="scraplingMode">` (fast/dynamic/stealth) visível só quando
  Scrapling. Aplica ao scrape e às chamadas de enriquecimento.
- `public/app.js`: anexa `engine` (e `scraplingMode`) aos params de `/api/scrape`,
  `/api/emails`, `/api/sitetext`, `/api/socials`.
- `server.js`: lê `engine`/`scraplingMode` por requisição, resolve via `getEngine()`,
  passa o engine para o scraper/caso-de-uso. Default = `playwright` (comportamento
  inalterado quando o usuário não troca).

### 3.7 Dependências novas

- `package.json`: `cloakbrowser` + `playwright-core` (peer). `postinstall` opcional
  para `cloakbrowser install` (ou lazy no 1º uso).
- `scrapling-sidecar/requirements.txt`: `scrapling[fetchers]`, `fastapi`, `uvicorn`.

## 4. Workstream 2 — Aceleração do CWV (mista, máxima)

### 4.1 Diagnóstico

O bulk enrich roda **Lighthouse completo (4 categorias) em todo lead** + healthcheck
serial de 12s. PSI leva 30–90s/site. É o gargalo.

### 4.2 Estratégia

1. **CrUX-first (campo real, ~300ms).** Novo `CruxClient`
   (`chromeuxreport.googleapis.com/v1/records:queryRecord`, mesma API key). Se o site
   tem amostra no CrUX → deriva `cwv_score`/`cwv_status` (LCP/INP/CLS + overall) sem
   rodar Lighthouse. Cobre sites com tráfego (rápido). A maioria das PMEs **não** terá
   campo → cai no passo 2.
2. **Lighthouse enxuto no fallback (bulk).** Para quem não tem CrUX, `PageSpeedClient`
   roda com **`category=performance` apenas** (≈2–4× mais rápido que 4 categorias),
   timeout **90s→45s**, conc **8→configurável (12–16)**. Preenche score/status/métricas.
3. **Lighthouse completo sob demanda.** As categorias extras (acessibilidade, boas
   práticas, SEO) e oportunidades só são necessárias no **relatório persuasivo**
   (`/api/report/:id/lead/...`) e na exportação detalhada. Mover o Lighthouse completo
   para esse momento (lazy, só nos leads que viram relatório) em vez de rodar em todos.
4. **Healthcheck:** remover o passo serial de 12s; o CrUX/PSI já erra rápido em site
   morto. Se quiser manter o "FORA DO AR", trocar por um HEAD de 3s **dentro** do pool
   (não serial).

### 4.3 Comportamento decidido: toggle na UI

Default = caminho rápido (passo 3 lazy): o bulk preenche só performance/CWV; as
colunas `score_acessibilidade`/`score_boas_praticas`/`score_seo` + oportunidades
aparecem só ao gerar o relatório do lead. **Um checkbox "análise profunda (mais
lenta)" na UI** liga as 4 categorias no bulk quando o usuário quiser (preenche tudo
de cara). O relatório persuasivo sempre dispara o Lighthouse completo se faltar.

### 4.4 Mudanças

- Novo `src/infrastructure/pagespeed/CruxClient.js`.
- `PageSpeedClient`: opção `categories` (default perf-only; full no relatório),
  `timeoutMs` default 45s.
- `EnrichLeads.js`: orquestra CrUX-first → Lighthouse-perf; healthcheck opcional/3s.
- `server.js`: `/api/enrich` aceita `deep=1` (4 categorias) e conc maior.
- UI: toggle "análise profunda (mais lenta)" opcional.

## 5. Não-objetivos (YAGNI)

- Scrapling no Maps deep-scrape interativo (fica como evolução p/ abordagem A).
- Self-host de Lighthouse local (alavanca extra documentada, fora da v1).
- Rotação de proxies / CAPTCHA solving (CloakBrowser "traga seu proxy").

## 6. Testes

- Engine: testes de contrato (mesma assinatura `fetchHtml`/`launchBrowser`) com um
  `FakeEngine`; smoke test real opt-in (env) para Cloak/Scrapling.
- CWV: unit do `CruxClient` (mock HTTP), do fluxo CrUX-first→fallback no `enrichLeads`
  (fakes), e do `PageSpeedClient` com `categories` perf-only.
- Pipeline: o teste existente `test/pipeline.test.js` continua verde com engine default.

## 7. Riscos

- Scrapling adiciona dependência Python ao deploy (aceito).
- Binário do CloakBrowser (~200MB) e licença de binário (uso livre, sem
  redistribuição) — documentar no README.
- CrUX cobre poucos sites de PME — o ganho médio vem mais do passo 3 (lazy) que do CrUX.
```
