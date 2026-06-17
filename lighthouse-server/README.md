# Lighthouse self-hosted (worker)

Instância(s) próprias do [Lighthouse](https://github.com/GoogleChrome/lighthouse)
para medir Core Web Vitals **sem depender da fila/limite da API PageSpeed do
Google**. Quanto mais instâncias, mais rápido o enriquecimento (vários sites
analisados em paralelo).

O worker fala o **mesmo contrato de query do PageSpeed**, então o app o usa só
preenchendo `LIGHTHOUSE_SERVER_URL` — nenhuma mudança de código no app.

```
GET /?url=<site>&strategy=mobile|desktop&category=performance[&category=seo...]
  -> Lighthouse Result (lhr) cru em JSON  (o PageSpeedClient aceita direto)
GET /healthz
  -> { ok, active, max, queued }
```

> O **CrUX** (dado de campo de usuários reais) continua vindo do Google — o
> Lighthouse só faz a parte de **laboratório**. É exatamente o que o app espera.

## Pré-requisitos

`lighthouse` e `chrome-launcher` já estão no `package.json` da raiz. O worker
reaproveita o **Chromium que o Playwright instala** (`npm install` na raiz já o
baixa), então não há download de outro Chrome.

```bash
npm install   # na raiz do projeto
```

## Rodar

> O worker lê o **`.env` da raiz** (assim como o app), então as variáveis abaixo
> podem ficar no `.env` em vez de irem na linha de comando. Variáveis passadas no
> ambiente têm precedência sobre o `.env` (a frota define `LH_PORT` por worker).

### 1 worker (dev)

```bash
npm run lighthouse                 # porta 3001, concorrência = núcleos - 1
LH_PORT=3002 LH_CONCURRENCY=4 npm run lighthouse
```

No app (`.env`):

```
LIGHTHOUSE_SERVER_URL=http://localhost:3001
```

Depois de mexer no `.env`, **reinicie o app** (ele só lê o `.env` ao iniciar).

### WSL / Chromium snap

No WSL o Chromium do Playwright não roda standalone (faltam libs como `libnspr4`),
e o Chromium snap não enxerga `/tmp`. Aponte o worker para o snap e dê um perfil
dentro de `~/snap` (no `.env`):

```
LH_CHROME_PATH=/usr/bin/chromium-browser
LH_USER_DATA_DIR=/home/<voce>/snap/chromium/common/lhrun
LIGHTHOUSE_SERVER_URL=http://localhost:3001
```

Crie o diretório uma vez: `mkdir -p ~/snap/chromium/common/lhrun`. Em produção
(Docker, abaixo) isso não é necessário — a imagem do Playwright já tem tudo.

### Frota local (várias instâncias, 1 máquina)

```bash
npm run lighthouse:fleet -- 4 3001   # 4 workers nas portas 3001..3004
```

Ele imprime a linha pronta — o app faz **round-robin** entre as URLs:

```
LIGHTHOUSE_SERVER_URL=http://localhost:3001,http://localhost:3002,http://localhost:3003,http://localhost:3004
```

### Docker, escalável (produção)

URL única na frente de N réplicas (nginx round-robin):

```bash
cd lighthouse-server
docker compose up --build --scale lighthouse=4
```

```
LIGHTHOUSE_SERVER_URL=http://localhost:3001
```

## Como o app usa

Na UI (Opções avançadas → *Fonte da análise de laboratório*):

- **PageSpeed do Google** — API pública (padrão).
- **Self-Hosted do Sistema** — frota self-hosted. Dois modos:
  - **Gerenciada (padrão)**: com `LIGHTHOUSE_SERVER_URL` vazio, o **app sobe a
    frota sozinho**, sob demanda, e a quantidade é escolhida no campo
    *Instâncias* (1..núcleos). Você não precisa rodar `npm run lighthouse` à mão —
    é a forma recomendada. Os workers herdam as `LH_*` do `.env`.
  - **Externa**: com `LIGHTHOUSE_SERVER_URL` preenchido, usa essas URLs (workers
    em outras máquinas/containers); o campo *Instâncias* some.
- **Outro servidor** — cola uma URL avulsa (ou várias, vírgula) só naquela análise.

> Os comandos `npm run lighthouse` / `lighthouse:fleet` continuam úteis para rodar
> workers manualmente (ex.: em outra máquina, atrás do nginx). Para o uso local
> comum, prefira a frota **gerenciada** acima.

## Variáveis de ambiente

| Var               | Padrão                  | O quê                                            |
|-------------------|-------------------------|--------------------------------------------------|
| `LH_PORT`         | `3001`                  | Porta HTTP do worker                             |
| `LH_CONCURRENCY`  | núcleos − 1             | Medições simultâneas por worker                  |
| `LH_CHROME_PATH`  | Chromium do Playwright  | Binário do Chrome a usar                         |
| `LH_CHROME_FLAGS` | —                       | Flags extras do Chrome (separadas por espaço)    |

## Dimensionar

Cada análise prende ~1 núcleo por dezenas de segundos. Regra de bolso:
**concorrência total ≈ núcleos disponíveis**. Para enriquecer N sites em paralelo
(o campo "Análises em paralelo" da UI), tenha capacidade total ≥ N entre todas as
instâncias, senão as requisições enfileiram (visível em `/healthz`).
