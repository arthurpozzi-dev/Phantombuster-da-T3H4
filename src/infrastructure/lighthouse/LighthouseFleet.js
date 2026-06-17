/**
 * Gerenciador de frota Lighthouse: sobe/reaproveita N workers (lighthouse-server)
 * sob demanda, em portas próprias, e devolve as URLs prontas para o round-robin
 * do PageSpeedClient. Assim o número de instâncias é controlado pelo front-end,
 * sem o usuário mexer em terminal/.env.
 *
 * Cada worker gerenciado roda com LH_CONCURRENCY=1, então "N instâncias" ≈ N
 * análises de laboratório em paralelo (1 Chrome por worker).
 *
 * spawnImpl/healthCheck são injetáveis para teste (sem subir processos reais).
 */
import os from "node:os";
import { spawn } from "node:child_process";

/** Aguarda o /healthz do worker responder, com timeout. */
async function waitForHealth(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return true;
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`worker ${url} não respondeu a tempo`);
}

export class LighthouseFleet {
  /**
   * @param {Object} opts
   * @param {string} opts.serverScript  caminho do lighthouse-server/server.js
   * @param {number} [opts.basePort=4100]      porta inicial dos workers gerenciados
   * @param {number} [opts.maxInstances]       teto de instâncias (padrão: min(8, núcleos))
   * @param {NodeJS.ProcessEnv} [opts.env]     env herdada pelos workers (LH_CHROME_PATH, etc.)
   * @param {typeof spawn} [opts.spawnImpl]    injeção p/ teste
   * @param {typeof waitForHealth} [opts.healthCheck]  injeção p/ teste
   */
  constructor({ serverScript, basePort = 4100, maxInstances, env = process.env, spawnImpl = spawn, healthCheck = waitForHealth } = {}) {
    this.serverScript = serverScript;
    this.basePort = basePort;
    this.maxInstances = Math.max(1, maxInstances || Math.min(8, os.cpus().length));
    this.env = env;
    this._spawnImpl = spawnImpl;
    this._healthCheck = healthCheck;
    this.workers = []; // índice = slot; { port, url, proc, alive, ready }
  }

  /** Limita n ao intervalo [1, maxInstances]. */
  clamp(n) {
    const v = parseInt(n, 10);
    if (!Number.isFinite(v) || v < 1) return 1;
    return Math.min(v, this.maxInstances);
  }

  /** Garante n workers de pé e prontos; devolve as URLs (uma por instância). */
  async ensure(n) {
    n = this.clamp(n);
    const slots = [];
    for (let i = 0; i < n; i++) {
      if (!this.workers[i] || !this.workers[i].alive) {
        this.workers[i] = this._spawn(this.basePort + i);
      }
      slots.push(this.workers[i]);
    }
    await Promise.all(slots.map((w) => w.ready));
    return slots.map((w) => w.url);
  }

  _spawn(port) {
    const url = `http://localhost:${port}`;
    const proc = this._spawnImpl(process.execPath, [this.serverScript], {
      stdio: "ignore",
      env: { ...this.env, LH_PORT: String(port), LH_CONCURRENCY: "1" },
    });
    const w = { port, url, proc, alive: true };
    proc.on("exit", () => (w.alive = false));
    proc.on("error", () => (w.alive = false));
    // Se não ficar pronto, marca como morto para a próxima ensure() respawnar.
    w.ready = Promise.resolve(this._healthCheck(url)).catch((e) => {
      w.alive = false;
      throw e;
    });
    return w;
  }

  /** Mata todos os workers (chamado no shutdown do app). */
  closeAll() {
    for (const w of this.workers) {
      try {
        w?.proc?.kill("SIGINT");
      } catch {
        /* já morto */
      }
    }
    this.workers = [];
  }
}
