import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { LighthouseFleet } from "../src/infrastructure/lighthouse/LighthouseFleet.js";

function fakeProc() {
  const ee = new EventEmitter();
  ee.kill = () => {};
  return ee;
}

function makeFleet({ maxInstances = 4 } = {}) {
  let spawnCount = 0;
  const procs = [];
  const fleet = new LighthouseFleet({
    serverScript: "x.js",
    basePort: 5000,
    maxInstances,
    spawnImpl: () => {
      spawnCount++;
      const p = fakeProc();
      procs.push(p);
      return p;
    },
    healthCheck: async () => true,
  });
  return { fleet, procs, get spawnCount() { return spawnCount; } };
}

test("ensure(n) spawns n workers and returns their URLs in order", async () => {
  const { fleet } = makeFleet();
  const urls = await fleet.ensure(3);
  assert.deepEqual(urls, ["http://localhost:5000", "http://localhost:5001", "http://localhost:5002"]);
});

test("ensure clamps to [1, maxInstances]", async () => {
  const { fleet } = makeFleet({ maxInstances: 4 });
  assert.equal((await fleet.ensure(99)).length, 4);
  assert.equal((await fleet.ensure(0)).length, 1);
  assert.equal((await fleet.ensure("abc")).length, 1);
});

test("ensure reuses live workers (no extra spawns)", async () => {
  const ctx = makeFleet();
  await ctx.fleet.ensure(2);
  assert.equal(ctx.spawnCount, 2);
  const urls = await ctx.fleet.ensure(2);
  assert.equal(ctx.spawnCount, 2); // nenhum spawn novo
  assert.deepEqual(urls, ["http://localhost:5000", "http://localhost:5001"]);
});

test("ensure respawns a worker that exited (same port)", async () => {
  const ctx = makeFleet();
  await ctx.fleet.ensure(2);
  assert.equal(ctx.spawnCount, 2);
  ctx.procs[0].emit("exit"); // worker do slot 0 morre
  const urls = await ctx.fleet.ensure(2);
  assert.equal(ctx.spawnCount, 3); // só o slot 0 sobe de novo
  assert.deepEqual(urls, ["http://localhost:5000", "http://localhost:5001"]);
});

test("a worker whose health check fails is marked dead and respawned", async () => {
  let calls = 0;
  const fleet = new LighthouseFleet({
    serverScript: "x.js",
    basePort: 6000,
    maxInstances: 2,
    spawnImpl: () => fakeProc(),
    healthCheck: async () => {
      calls++;
      if (calls === 1) throw new Error("timeout"); // primeira instância falha
      return true;
    },
  });
  await assert.rejects(() => fleet.ensure(1), /timeout/);
  // próxima chamada respawna (worker anterior ficou morto) e agora passa
  const urls = await fleet.ensure(1);
  assert.deepEqual(urls, ["http://localhost:6000"]);
});

test("closeAll kills all workers and resets", async () => {
  const ctx = makeFleet();
  await ctx.fleet.ensure(3);
  let killed = 0;
  for (const p of ctx.procs) p.kill = () => killed++;
  ctx.fleet.closeAll();
  assert.equal(killed, 3);
  assert.equal(ctx.fleet.workers.length, 0);
});
