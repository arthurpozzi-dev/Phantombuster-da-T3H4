# Maps Leads Scraper · T3H4

Ferramenta local (estilo Phantombuster) que coleta leads do **Google Maps** e os
processa por um pipeline completo até virarem **planilhas prontas para prospecção**.
Aceita **vários links/termos de uma vez** (um por linha) e gera uma planilha por busca.

```
Google Maps → COLETA → LIMPEZA → FILTRO → SEPARAÇÃO (com site / sem site)
            → ENRIQUECIMENTO (CWV) → TEXTO DO SITE → RELATÓRIO → EXPORT (.zip)
```

## O que ela faz

1. **Coleta** os estabelecimentos de uma ou **várias** buscas/links do Maps (um por linha),
   extraindo: nome, categoria, avaliação (nota), quantidade de avaliações, telefone,
   **WhatsApp**, site, redes sociais, descrição e o link do Google Maps.
2. **Limpa** a lista: remove leads vazios/sem contato e junta duplicatas.
3. **Filtra** por reputação: mantém só quem tem entre **5 e 100 avaliações** e **nota ≥ 4,0**
   (limites ajustáveis na interface).
4. **Separa** em duas listas: **com site** e **sem site**. Quem coloca Instagram, Facebook,
   X ou um Linktree no lugar do site vai para "sem site" (o link é guardado em *Redes Sociais*).
5. **Enriquece** a lista "com site" com um **relatório completo** do site via PageSpeed
   Insights API: pontuação de performance (0–100) + status **RUIM / MÉDIO / BOM**, as 4
   categorias do Lighthouse (Performance, Acessibilidade, Boas Práticas, SEO), as métricas
   de laboratório (LCP, FCP, CLS, TBT, Speed Index, TTI), os dados de campo de usuários
   reais (CrUX, quando houver) e as principais oportunidades de melhoria. Na tela, o botão
   **📊 ver** abre o relatório detalhado de cada site.
6. **Gera um relatório de auditoria persuasivo** (HTML) para cada site, traduzindo as
   métricas técnicas em uma narrativa de vendas — por que cada problema está custando
   clientes — pronto para apresentar ao lead. Botão **📄 venda** por item (abre em nova aba).
7. **Puxa o texto de cada site** (botão **🔤 Puxar texto dos sites**) e grava o conteúdo
   condensado numa única célula da planilha — útil para análise/IA.
8. **Exporta tudo num pacote** (botão **📦 Exportar tudo (.zip)**): uma **pasta por busca**,
   cada uma com as planilhas em **CSV** (com-site / sem-site) e os relatórios HTML.
   (O XLSX continua disponível nos botões avulsos por busca.)
   A planilha "com site" traz, além das métricas do PageSpeed, a **nota de auditoria (/10)**,
   o **CrUX**, as **oportunidades**, o **texto do site** e o **nome do arquivo do relatório**
   correspondente. (Também dá para baixar a planilha de uma busca avulsa em CSV/XLSX.)

## Como rodar

Requisitos: **Node.js 18+** (testado no 22).

```bash
npm install      # instala dependências + baixa o Chromium do Playwright
npm start        # sobe o servidor em http://localhost:3000
npm test         # roda os testes das funções puras do pipeline
```

Abra **http://localhost:3000**, cole o link do Google Maps (ou digite um termo como
`dentistas em São Carlos`), ajuste os filtros se quiser e clique em **Buscar leads**.
Depois, na aba *Com site*, clique em **Enriquecer sites** para rodar o Core Web Vitals.
Use os botões **CSV / XLSX** em cada aba para baixar as planilhas.

## Chave da PageSpeed API

O enriquecimento usa a [PageSpeed Insights API](https://developers.google.com/speed/docs/insights/v5/get-started).
A chave fica no arquivo **`.env`** (`PAGESPEED_API_KEY=...`) e é usada por padrão. Você também
pode digitar uma chave diferente no campo **Chave PageSpeed** da interface — ela tem prioridade
sobre a do `.env` naquela execução. Veja `.env.example` para o formato.

> Sem chave, a API funciona com limites muito baixos e costuma bloquear. Com chave, o limite é
> de ~25 mil consultas/dia (240/min).

### Velocidade do enriquecimento (análise em massa)

Cada análise do Lighthouse leva ~10–90s **no servidor do Google** — não dá para acelerar uma
análise isolada. Por isso elas rodam **em paralelo**: o campo **Análises em paralelo** da
interface (padrão **8**) controla quantos sites são medidos ao mesmo tempo. Com 8, medir 8 sites
leva ~o tempo de 1. Ajuste pelo campo ou pela env `ENRICH_CONCURRENCY`. Valores muito altos
(>15) podem esbarrar no limite de 240/min da API. Sites lentos têm timeout de 90s e viram `N/A`
com o motivo no tooltip.

## Relatório de auditoria (para apresentar ao lead)

Depois de enriquecer os sites, cada lead da aba *Com site* ganha dois botões:

- **📊 ver** — abre o relatório técnico (métricas cruas, para você analisar).
- **📄 venda** — abre, em nova aba, um **relatório de auditoria persuasivo** baseado no
  PageSpeed, mas escrito para o **dono do negócio**: sem tecnês, contando por que cada
  problema (lentidão, travamentos, instabilidade, SEO…) está derrubando a conversão dele,
  e contrastando a ótima reputação no Google com a experiência ruim do site.

O botão **📦 Exportar tudo (.zip)** inclui, em cada pasta de busca, um HTML por site
enriquecido (dentro de `relatorios/`). Cada relatório é uma página pronta para apresentar
(ou salvar em PDF via `Ctrl+P`). O modelo fica em
`src/infrastructure/report/audit-template.html` e a narrativa em
`src/application/buildAuditReportModel.js`. O botão final ("Ver a versão reconstruída") aponta
para `REPORT_CTA_URL` (configurável no `.env`).

## Windows × Linux (navegador)

A coleta detecta o sistema operacional automaticamente:

- **Windows** — usa o Chromium que vem com o Playwright (sem configuração).
- **Linux / WSL / servidor** — usa o **Chromium do sistema** (procura em
  `/usr/bin/chromium-browser`, `/usr/bin/chromium`, `/snap/bin/chromium`, etc.) e sobe com
  as flags de sandbox necessárias (`--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage`).
  Instale com `sudo apt install chromium-browser` (ou `chromium`). Para forçar um caminho
  específico, defina `CHROMIUM_PATH` no `.env`.

## Campos coletados

| Coluna | Descrição |
|---|---|
| Nome | Nome da empresa |
| Categoria | Categoria do estabelecimento |
| Avaliação | Nota (ex.: 4,7) |
| Qtd. Avaliações | Número de avaliações |
| Telefone | Telefone formatado |
| WhatsApp | Link `wa.me` — ver heurística abaixo |
| Site | Site próprio (só na lista "com site") |
| Redes Sociais | Instagram/Facebook/Linktree etc. |
| Descrição | Descrição/resumo, quando houver |
| Link Google Maps | Link da ficha (Google Meu Negócio) |
| Pontuação CWV | Performance 0–100 (lista "com site", após enriquecer) |
| Status CWV | RUIM / MÉDIO / BOM (lista "com site", após enriquecer) |

### Heurística do WhatsApp

O Google Maps não diz se um número tem WhatsApp. Assumimos que **celulares brasileiros**
(DDD + 9 dígitos começando em 9) têm, e geramos `https://wa.me/55<numero>`. Se houver um link
explícito de WhatsApp no painel, ele tem prioridade. Telefones fixos ficam sem link.

## Estrutura do projeto

O código segue **Clean Architecture** (detalhes em [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)):

```
src/
  domain/          regras puras (entidade Lead, classificação social/CWV)
  application/     casos de uso (limpeza, filtro, separação, enriquecimento, pipeline)
  infrastructure/  adaptadores (Playwright, PageSpeed, export CSV/XLSX, servidor HTTP)
  main.js          composition root (liga tudo e sobe o servidor)
public/            front-end (index.html + styles.css + app.js)
test/              testes das funções puras
```

## Avisos

- O scraping do Google Maps fica numa **área cinzenta dos Termos de Uso do Google**.
  Use para dados públicos, em volume moderado, por sua conta e risco.
- O HTML do Maps muda com frequência. Se a coleta parar de funcionar, os seletores CSS
  em `src/infrastructure/scraper/GoogleMapsScraper.js` (ex.: `a.hfpxzc`, `data-item-id`)
  podem precisar de ajuste.
- A chave de API fica no `.env`, que está no `.gitignore` — **não suba sua chave para o git**.
