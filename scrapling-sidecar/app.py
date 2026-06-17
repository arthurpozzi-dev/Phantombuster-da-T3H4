"""
Sidecar HTTP do Scrapling.

Expõe os 3 fetchers do Scrapling para o app Node (que é JavaScript e não pode
importar a lib Python diretamente):

  - mode="fast"    -> Fetcher.get          (HTTP + impersonação de TLS, rápido)
  - mode="dynamic" -> DynamicFetcher.fetch (Playwright Chromium)
  - mode="stealth" -> StealthyFetcher.fetch (Camoufox, resolve Cloudflare)

Roda apenas em 127.0.0.1. Pré-requisitos: Python >=3.10 e
`pip install -r requirements.txt` + `scrapling install` (baixa os browsers).

Uso: python app.py --port 8765
"""
import os
import argparse

from fastapi import FastAPI
from pydantic import BaseModel
from scrapling.fetchers import Fetcher, DynamicFetcher, StealthyFetcher

app = FastAPI()


class FetchReq(BaseModel):
    url: str
    mode: str = "fast"
    timeout: int = 20000  # ms
    network_idle: bool = False


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/fetch")
def fetch(req: FetchReq):
    try:
        if req.mode == "stealth":
            page = StealthyFetcher.fetch(
                req.url, headless=True, network_idle=req.network_idle, timeout=req.timeout
            )
        elif req.mode == "dynamic":
            page = DynamicFetcher.fetch(
                req.url, headless=True, network_idle=req.network_idle, timeout=req.timeout
            )
        else:
            page = Fetcher.get(req.url, stealthy_headers=True, timeout=req.timeout / 1000)
        return {
            "html": str(page.html_content),
            "status": getattr(page, "status", 200),
            "final_url": req.url,
        }
    except Exception as e:  # noqa: BLE001 — devolve erro legível ao Node
        return {"html": "", "status": 0, "final_url": req.url, "error": str(e)}


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument(
        "--port", type=int, default=int(os.environ.get("SCRAPLING_SIDECAR_PORT", "8765"))
    )
    args = p.parse_args()
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
