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
7b. **Descobre as redes sociais** (botão **🔗 Buscar redes sociais**), complementando o que
   o Maps já trouxe. Para leads **com site**, extrai os perfis (Instagram, Facebook, etc.)
   do HTML do próprio site (home + páginas de contato) — desofuscando e descartando links de
   compartilhamento/posts, mantendo só o perfil canônico (inclui **LinkedIn**: `/in/` e
   `/company/`). Sites 100% JavaScript usam o mesmo fallback de navegador dos e-mails. Para quem
   ficou **sem nenhuma rede** (com ou sem site), o checkbox **Redes via busca web** liga uma
   descoberta opcional que pesquisa o nome do lead num buscador (Instagram, Facebook e LinkedIn;
   mais lento e pode trazer o perfil errado — por isso é opt-in). Tudo é
   **mesclado** no campo *Redes Sociais*, sem perder o que já havia. O passe de **e-mails**
   também já preenche as redes encontradas (mesmo download), de graça.
   **Validação (double-check):** cada rede guarda de onde veio. Links do próprio site/Maps são
   confiáveis; os achados por **busca web** ganham um ⚠️ na tabela e entram na coluna
   **`redes_revisar`** do export (e a **`redes_confianca`** resume o lead: alta/média/baixa,
   cruzando a fonte com o quanto o nome do negócio casa com o handle do perfil) — assim você
   confere à mão só os incertos.
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

O enriquecimento de CWV roda em **modo rápido** por padrão:

1. **CrUX primeiro** — busca o dado de campo real (Chrome UX Report, ~300ms). Sites com
   tráfego suficiente são pontuados na hora, sem rodar o Lighthouse.
2. **Lighthouse enxuto** no fallback — para sites sem dado de campo, mede só a categoria
   `performance` (bem mais rápido que as 4 categorias), com timeout de 45s.
3. **Lighthouse completo sob demanda** — acessibilidade/SEO/boas-práticas + oportunidades são
   geradas só quando você abre o **relatório** de um lead (ou liga a análise profunda).

As medições rodam **em paralelo**: o campo **Análises em paralelo** (padrão **12**) controla
quantos sites ao mesmo tempo (env `ENRICH_CONCURRENCY`). Valores muito altos (>15) podem
esbarrar no limite de ~240/min da API.

Marque **Análise profunda (mais lenta)** para rodar o Lighthouse completo (4 categorias) em
todos os sites já no enriquecimento em massa — preenche as colunas de acessibilidade/SEO/boas
práticas de uma vez, ao custo de mais tempo. A chave da PageSpeed também é usada para o CrUX.

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

## Engines de scraping (Playwright / CloakBrowser / Scrapling)

Um seletor **Engine** na interface escolhe como a coleta e o enriquecimento acessam a web.
Vale tanto para o scrape do Google Maps quanto para os fetches de sites de terceiros
(e-mails, texto, health). Padrão: **Playwright** (comportamento de sempre).

| Engine | Quando usar | Instalação |
|--------|-------------|------------|
| **Playwright** | Padrão. Já vem instalado. | nenhuma |
| **CloakBrowser** | Anti-ban: Chromium stealth (passa Cloudflare Turnstile/FingerprintJS, `webdriver=false`). Drop-in do Playwright. | `npm install` já traz o pacote; o binário (~200MB) baixa sozinho em `~/.cloakbrowser/` no 1º uso. Licença do binário: uso livre, sem redistribuição. |
| **Scrapling** | Fetch rápido/stealth de alto volume (impersonação de TLS, Camoufox, bypass de Cloudflare). Cobre a **camada de fetch**. | Requer o sidecar Python — ver `scrapling-sidecar/README.md` (Python ≥3.10, `pip install -r requirements.txt`, `scrapling install`). |

**Modo Scrapling** (`fast` / `dynamic` / `stealth`) aparece ao escolher Scrapling:
`fast` = HTTP + TLS; `dynamic` = browser (Playwright); `stealth` = Camoufox (resolve Cloudflare).

**Limitação do Scrapling no Maps:** o Scrapling não abre um navegador ao vivo para o scroll
interativo do Maps. Quando selecionado para uma busca normal, a **coleta** cai para o
Playwright (com aviso na tela) e o **enriquecimento** usa o Scrapling normalmente. Para o
fallback de e-mails em sites JS, o CloakBrowser é usado quando esse engine estiver selecionado.

## Windows × Linux (navegador)

A coleta detecta o sistema operacional automaticamente:

- **Windows** — usa o Chromium que vem com o Playwright (sem configuração).
- **Linux / WSL / servidor** — usa o **Chromium do sistema** (procura em
  `/usr/bin/chromium-browser`, `/usr/bin/chromium`, `/snap/bin/chromium`, etc.) e sobe com
  as flags de sandbox necessárias (`--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage`).
  Instale com `sudo apt install chromium-browser` (ou `chromium`). Para forçar um caminho
  específico, defina `CHROMIUM_PATH` no `.env`.

### WSL / Ubuntu sem o Chromium do sistema (ou só com a versão *snap*)

No WSL o Chromium do sistema costuma ser um **snap**, que **não funciona** com o Playwright.
A configuração que funciona (e já está aplicada neste repo):

1. **Rode o projeto no filesystem do Linux** (ex.: `~/projects/...`), nunca em `/mnt/c|f|...`
   — no drive Windows o `node_modules` é lido via 9P e a app leva ~30s para subir (no Linux, ~2s).
2. Baixe o Chromium do Playwright: `npx playwright install chromium`.
3. Aponte o `.env` para ele: **`CHROMIUM_PATH=playwright`** (valor especial que ignora o snap).
4. **Libs do Chromium** (`libnss3`, `libnspr4`, `libasound2t64`). Com `sudo`:
   `npx playwright install-deps chromium`. **Sem `sudo`**, extraia-as localmente — a coleta
   adiciona essa pasta ao `LD_LIBRARY_PATH` automaticamente se ela existir:

   ```bash
   mkdir -p .chromium-libs/debs && cd .chromium-libs/debs
   apt-get download libnss3 libnspr4 libasound2t64
   cd .. && for d in debs/*.deb; do dpkg -x "$d" extracted; done
   ```

   (`.chromium-libs/` é ignorada pelo git; recrie com os comandos acima se sumir.)

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
| instagram / facebook / linkedin | Perfil daquela rede, um por coluna |
| outras_redes | Demais redes (YouTube, TikTok, Linktree, WhatsApp de site…) |
| redes_confianca | Confiança geral das redes do lead: alta / média / baixa |
| redes_revisar | Links a conferir à mão (descobertos por busca web) |
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
