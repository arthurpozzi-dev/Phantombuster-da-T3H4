# Maps Leads Scraper (estilo Phantombuster)

Ferramenta local que coleta leads do Google Maps a partir de um **link de pesquisa**
(ou de um termo de busca) e exporta uma **planilha CSV e XLSX** com os dados de cada
estabelecimento: nome, categoria, nota, nº de avaliações, telefone, endereço, site,
plus code e link do Maps.

## Como usar

```powershell
cd "C:\Users\User\Documents\codigos\PHATOMBUSTER DA T3H4"
npm install          # instala dependências + baixa o Chromium do Playwright
npm start            # sobe o servidor
```

Abra **http://localhost:3000**, cole o link do Google Maps (ou digite um termo como
`dentistas em São Carlos`), clique em **Buscar leads** e baixe a planilha.

## Opções

- **Máx. de resultados** — `0` coleta tudo o que a lista carregar; um número limita.
- **Coleta detalhada** — abre cada local para pegar telefone, site e endereço completos.
  Mais lento, porém muito mais completo. Desmarque para uma varredura rápida só com os
  dados visíveis na lista.

## Como funciona

1. `scraper.js` abre o link no Chromium (Playwright), aceita o consentimento de cookies,
   rola o painel de resultados até o fim e extrai os cards. Em modo detalhado, clica em
   cada local e lê o painel lateral.
2. `server.js` expõe o progresso ao vivo via Server-Sent Events e gera os downloads.
3. `export.js` monta o CSV (com BOM p/ Excel) e o XLSX formatado (ExcelJS).

## Avisos

- O scraping do Google Maps fica numa **área cinzenta dos Termos de Uso do Google**.
  Use para dados públicos, em volume moderado e por sua conta e risco.
- O Maps muda o HTML de tempos em tempos. Se a coleta parar de funcionar, os seletores
  CSS em `scraper.js` (ex.: `.Nv2PK`, `a.hfpxzc`, `data-item-id`) podem precisar de ajuste.
- Para uso pesado/estável e dentro dos Termos, considere a **Google Places API** (paga).
