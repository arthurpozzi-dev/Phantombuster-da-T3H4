# Arquitetura

O projeto segue **Clean Architecture**: o código é dividido em camadas e as
**dependências apontam sempre para dentro** — em direção ao domínio. O domínio
não conhece o Playwright, o Express nem a PageSpeed; quem conhece esses detalhes
são as camadas de fora.

```
┌─────────────────────────────────────────────────────────────┐
│  infrastructure / presentation  (Playwright, Express, HTTP)  │
│   ┌─────────────────────────────────────────────────────┐    │
│   │  application  (casos de uso / orquestração)          │    │
│   │     ┌───────────────────────────────────────────┐   │    │
│   │     │  domain  (regras puras, sem I/O)           │   │    │
│   │     └───────────────────────────────────────────┘   │    │
│   └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
            (as setas de dependência apontam para dentro)
```

## Camadas

### `domain/` — regras puras

Nenhum I/O (sem rede, disco ou browser). É a parte mais estável e testável.

- **`Lead.js`** — a entidade `Lead`, a fábrica `createLead()` (que normaliza tudo) e
  funções puras de normalização: `parseRating`, `parseReviews`, `formatPhone`,
  `toWhatsAppLink`, `hasUsefulContact`.
- **`classification.js`** — a lista `SOCIAL_DOMAINS`, `isSocialOrAggregator()` (site
  próprio × rede social), os limites `CWV_THRESHOLDS` e `classifyCwv()` (RUIM/MÉDIO/BOM).

### `application/` — casos de uso

Orquestram as regras do domínio. Recebem dependências externas por **injeção** (ex.: o
enriquecimento recebe um cliente de PageSpeed), sem saber qual a implementação concreta.

- **`CleanLeads.js`** — normaliza, remove vazios e junta duplicatas (chave `link_maps`,
  fallback `nome+telefone`).
- **`FilterLeads.js`** — filtra por faixa de avaliações e nota mínima (padrões em `DEFAULT_FILTER`).
- **`SplitLeads.js`** — separa em `comSite` / `semSite` usando `isSocialOrAggregator`.
- **`EnrichLeads.js`** — roda a análise de Core Web Vitals em série sobre a lista `comSite`.
- **`runPipeline.js`** — encadeia Limpeza → Filtro → Separação e devolve as listas + `stats`.

### `infrastructure/` — adaptadores

Implementações concretas que falam com o mundo externo.

- **`scraper/GoogleMapsScraper.js`** — Playwright/Chromium. Devolve leads **crus** (texto);
  a normalização é do domínio.
- **`pagespeed/PageSpeedClient.js`** — cliente HTTP da PageSpeed Insights API v5 (`fetch` nativo).
- **`export/`** — `columns.js` (colunas por lista), `csvExporter.js`, `xlsxExporter.js`.
- **`http/server.js`** — Express + SSE + store em memória; recebe o `scraper` por injeção.

### `main.js` — composition root

O único lugar que cria as implementações concretas e as injeta (`GoogleMapsScraper` →
`createServer`). Também carrega o `.env`. Trocar um adaptador (ex.: usar a Places API no
lugar do Playwright) significa mexer só aqui.

### `public/` — apresentação (front-end)

`index.html` + `styles.css` + `app.js`. Conversa com o back via SSE (`/api/scrape`,
`/api/enrich`) e baixa as planilhas (`/api/download/:id/:list.:ext`).

## Fluxo de uma requisição

```
Front (app.js)
   │  GET /api/scrape?input=...&minAval=...      (SSE: progress/done)
   ▼
http/server.js ──> GoogleMapsScraper.scrape() ──> leads crus
   │                                                  │
   │              runPipeline(raw, filtros) ──> cleanLeads → filterLeads → splitLeads
   ▼                                                  │
guarda { comSite, semSite, stats } no store ◄─────────┘
   │  done: { id, stats, comSite, semSite }
   ▼
Front mostra resumo + 2 abas

   │  GET /api/enrich/:id?key=...                (SSE: progress/done)
   ▼
http/server.js ──> enrichLeads(comSite, PageSpeedClient) ──> atualiza store
   │  done: { comSite enriquecido }
   ▼
Front re-renderiza a aba "com site" com Pontuação/Status

   │  GET /api/download/:id/com-site.xlsx
   ▼
http/server.js ──> columnsFor() + toXLSX()/toCSV() ──> arquivo
```

## Por que assim?

- **Testável**: as regras de negócio (limpeza, filtro, separação, classificação) são
  funções puras testadas em `test/pipeline.test.js`, sem subir browser nem rede.
- **Trocável**: o scraper e o cliente de PageSpeed são adaptadores atrás de uma fronteira;
  dá para substituí-los sem tocar nas regras de negócio.
- **Legível**: cada arquivo tem uma responsabilidade única e documentada (JSDoc).
