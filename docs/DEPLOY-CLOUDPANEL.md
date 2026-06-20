# Deploy no CloudPanel (VPS) — Maps Leads Scraper

Runbook para subir o app numa VPS com **CloudPanel** (Debian 12 / Ubuntu 22.04+).

**Perfil deste deploy** (decidido com o time):
- Engines: **core (Playwright + PageSpeed API) + Scrapling**.
- **Sem** CloakBrowser e **sem** Lighthouse self-hosted — eles só rodam sob demanda,
  então basta não selecioná-los na UI. Para CWV use o modo **PageSpeed API**.
- Acesso protegido por **Basic Auth no Nginx** (o app não tem login próprio).
- VPS de referência: **2 vCPU / 8 GB RAM**.

Convenções abaixo:
- `SITE_USER` = usuário do site criado pelo CloudPanel (ex.: `maps-leads`).
- `APP_DIR` = `/home/$SITE_USER/htdocs/<dominio>` (raiz do site).
- `PORT` = `3000` (porta interna do app; o Nginx do CloudPanel faz proxy pra ela).

---

## 0. Pré-requisitos no sistema (como root/sudo)

```bash
# Confirme o SO (CloudPanel roda em Debian 12 / Ubuntu 22.04/24.04)
lsb_release -a

# Node.js 22 (o app é ESM e usa recursos do Node 22+)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version   # deve ser v22.x

# Bibliotecas de sistema para o Chromium do Playwright rodar headless
sudo npx --yes playwright install-deps chromium

# Python ≥3.10 + venv (para o sidecar Scrapling)
sudo apt-get install -y python3 python3-venv python3-pip
python3 --version   # deve ser ≥3.10
```

---

## 1. Criar o site no CloudPanel (UI)

1. **Sites → Add Site → Create a Node.js Site** (ou "Reverse Proxy" apontando para `http://127.0.0.1:3000`).
2. **Domain name**: ainda não há domínio próprio. Use um hostname que resolve no IP da VPS:
   - `SEU_IP.nip.io` (ex.: `203.0.113.10.nip.io`) — resolve automaticamente para o IP
     e permite até emitir Let's Encrypt. Troca por `leads.t3h4.com.br` quando tiver o domínio.
3. **App Port**: `3000`. Isso cria o vhost Nginx fazendo proxy para `127.0.0.1:3000`.
4. Anote o **Site User** criado (`SITE_USER`).

### 1.1 Basic Auth (proteção de acesso)
- No site: **Security → Basic Auth → Add** → defina usuário e senha.
- A partir daí o navegador pede login antes de chegar no app.

### 1.2 SSL
- **SSL/TLS → Let's Encrypt** (funciona com `nip.io`). Sem domínio próprio você também
  pode seguir só por HTTP no começo — mas com Basic Auth, prefira HTTPS para a senha
  não trafegar em texto puro.

---

## 2. Deploy do código (como `SITE_USER`)

Acesse como o usuário do site: `sudo su - SITE_USER` (ou SSH direto com esse usuário).

```bash
cd ~/htdocs/<dominio>          # APP_DIR

# Clonar o repositório (escolha a branch que quer publicar; provavelmente feat/ui-redesign)
# Repo privado: gere um deploy key novo nesta VPS e cadastre no GitHub (Deploy keys),
# ou use um Personal Access Token via HTTPS.
git clone -b feat/ui-redesign https://github.com/arthurpozzi-dev/scraping-leads-t3h4.git .

# Instalar deps (o postinstall baixa o Chromium do Playwright automaticamente)
npm ci
```

### 2.1 Configurar `.env`
```bash
cp .env.example .env
nano .env
```
Valores recomendados para 2 vCPU / 8 GB:
```dotenv
PAGESPEED_API_KEY=<sua_chave_da_PageSpeed_Insights>
PORT=3000
HOST=127.0.0.1                 # só aceita conexões locais (Nginx) — ver §4

REPORT_CTA_URL=https://t3h4.com.br

# CWV via API do Google (trabalho roda no Google, pode paralelizar alto)
ENRICH_CONCURRENCY=24

# Tudo que usa navegador local deve ficar baixo nesta VPS (2 núcleos)
EMAIL_BROWSER_CONCURRENCY=2
EMAIL_ENGINE_CONCURRENCY=4
SITETEXT_CONCURRENCY=6
SOCIAL_CONCURRENCY=20          # fetch nativo (I/O), escala bem

# Deixe CHROMIUM_PATH vazio: em Linux com as libs, usa o Chromium do Playwright.
# LIGHTHOUSE_SERVER_URL vazio e NÃO use o modo self-hosted na UI (use PageSpeed API).
```

### 2.2 Preparar o sidecar Scrapling (uma vez)
```bash
cd ~/htdocs/<dominio>/scrapling-sidecar
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
scrapling install            # baixa os browsers usados pelos fetchers (~centenas de MB)
deactivate
```
O app sobe o sidecar sozinho (via `child_process`) quando o engine Scrapling é
escolhido; ele encontra a venv em `scrapling-sidecar/.venv` automaticamente.
Se o `python3` do sistema não for ≥3.10, defina `SCRAPLING_PYTHON=python3.11` no `.env`.

### 2.3 Smoke test manual
```bash
cd ~/htdocs/<dominio>
node src/main.js          # deve logar "rodando em: http://localhost:3000"
# noutro terminal:  curl -I http://127.0.0.1:3000   → 200
# Ctrl+C para parar
```

---

## 3. Manter o app no ar com PM2

```bash
# como SITE_USER
npm install -g pm2        # ou: npx pm2 ...
cd ~/htdocs/<dominio>
pm2 start ecosystem.config.cjs    # config versionada (autorestart + max_memory_restart 2G)
pm2 save

# Persistir no boot (rode o comando que o PM2 imprimir; precisa de sudo uma vez):
pm2 startup systemd
# ... copie/cole a linha "sudo env PATH=... pm2 startup systemd -u SITE_USER --hp /home/SITE_USER"
```
Comandos úteis: `pm2 logs maps-leads`, `pm2 restart maps-leads`, `pm2 status`.

---

## 4. Firewall / endurecimento

- Com `HOST=127.0.0.1` no `.env`, o app **não** escuta na internet — só o Nginx alcança.
- Garanta o firewall (CloudPanel usa o seu; via UFW seria):
  ```bash
  sudo ufw allow 22,80,443/tcp
  sudo ufw enable
  ```
- A porta `3000` **nunca** deve estar aberta externamente. Acesso sempre via domínio + Basic Auth.

---

## 5. Atualizações futuras (deploy de nova versão)
```bash
sudo su - SITE_USER
cd ~/htdocs/<dominio>
git pull
npm ci
pm2 restart maps-leads
```

---

## Notas de capacidade (2 vCPU / 8 GB)
- O gargalo é **CPU** quando há navegador (deep-scrape de e-mail Fase 2, Scrapling
  `dynamic`/`stealth`). Mantenha as concorrências de browser baixas (§2.1).
- CWV: use **PageSpeed API** (trabalho no Google) — Lighthouse self-hosted nesta VPS
  brigaria pelos 2 núcleos e geraria timeouts.
- Se precisar de mais throughput de scraping, escale vertical (mais vCPU) antes de
  ligar engines pesados.
