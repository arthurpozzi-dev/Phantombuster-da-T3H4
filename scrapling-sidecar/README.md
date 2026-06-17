# Scrapling Sidecar

Serviço HTTP local (Python) que expõe os fetchers do [Scrapling](https://github.com/D4Vinci/Scrapling)
para o app Node, que seleciona o engine **Scrapling** na UI.

O app Node sobe este sidecar automaticamente (via `child_process`) quando o engine
Scrapling é escolhido. Você só precisa garantir os pré-requisitos abaixo uma vez.

## Pré-requisitos (uma vez)

Requer **Python ≥ 3.10**.

```bash
cd scrapling-sidecar
python -m venv .venv
. .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements.txt
scrapling install               # baixa os browsers (Camoufox/Chromium) usados pelos fetchers
```

> Se o `python` do sistema não for ≥3.10, ajuste o comando que o Node usa para
> subir o sidecar via env `SCRAPLING_PYTHON` (ex.: `python3.11`).

## Endpoints

- `GET /health` → `{"status":"ok"}`
- `POST /fetch` `{ url, mode, timeout, network_idle? }` → `{ html, status, final_url }`
  - `mode`: `fast` (HTTP/TLS), `dynamic` (Playwright), `stealth` (Camoufox/Cloudflare)

## Smoke test manual

```bash
python app.py --port 8765 &
curl -s localhost:8765/health
curl -s -X POST localhost:8765/fetch -H 'content-type: application/json' \
  -d '{"url":"https://example.com","mode":"fast"}' | head -c 300
```

## Notas

- Liga apenas em `127.0.0.1` — não exponha externamente.
- Atributos usados: `page.html_content` e `page.status` (validados contra Scrapling 0.4.9).
