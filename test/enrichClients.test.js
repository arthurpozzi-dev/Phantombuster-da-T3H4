import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEnrichClients } from "../src/infrastructure/http/enrichClients.js";

class SpyPS {
  constructor(opts) { this.opts = opts; }
}
class SpyCrux {
  constructor(opts) { this.opts = opts; }
}

test("deep mode builds a 4-category PageSpeed client and no CrUX", () => {
  const { pageSpeed, crux, categories } = buildEnrichClients({
    apiKey: "k", deep: true, PageSpeedClientCtor: SpyPS, CruxClientCtor: SpyCrux,
  });
  assert.equal(categories.length, 4);
  assert.deepEqual(pageSpeed.opts.categories, ["performance", "accessibility", "best-practices", "seo"]);
  assert.equal(crux, null);
});

test("fast mode builds perf-only PageSpeed client and a CrUX client", () => {
  const { pageSpeed, crux, categories } = buildEnrichClients({
    apiKey: "k", deep: false, PageSpeedClientCtor: SpyPS, CruxClientCtor: SpyCrux,
  });
  assert.deepEqual(categories, ["performance"]);
  assert.deepEqual(pageSpeed.opts.categories, ["performance"]);
  assert.ok(crux instanceof SpyCrux);
  assert.equal(crux.opts.apiKey, "k");
});
