import { test } from "node:test";
import assert from "node:assert/strict";
import { createEngineRegistry } from "../src/infrastructure/engine/registry.js";

test("registry resolves each engine and caches", () => {
  const reg = createEngineRegistry();
  assert.equal(reg.get("playwright").name, "playwright");
  assert.equal(reg.get("cloakbrowser").name, "cloakbrowser");
  const s = reg.get("scrapling", { mode: "stealth" });
  assert.equal(s.name, "scrapling");
  assert.equal(s.mode, "stealth");
  // same instance cached
  assert.equal(reg.get("playwright"), reg.get("playwright"));
  assert.equal(reg.get("scrapling", { mode: "stealth" }), reg.get("scrapling", { mode: "stealth" }));
});

test("unknown engine name falls back to playwright", () => {
  const reg = createEngineRegistry();
  assert.equal(reg.get("bogus").name, "playwright");
  assert.equal(reg.get(undefined).name, "playwright");
});

test("closeAll closes cached engines", async () => {
  const reg = createEngineRegistry();
  reg.get("playwright");
  reg.get("cloakbrowser");
  await reg.closeAll(); // must not throw
});
