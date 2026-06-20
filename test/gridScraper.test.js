/**
 * Testes do adaptador de busca por grid (sem rede — fetch é injetado).
 * Roda com: npm test  (usa o test runner nativo do Node).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  GoogleMapsGridScraper,
  generateGrid,
  bboxFromCenter,
  buildPbUrl,
  unwrapSite,
  mapBusiness,
  findBusinesses,
  parseMapsResponse,
} from "../src/infrastructure/scraper/GoogleMapsGridScraper.js";

// Nó de negócio sintético no formato do JSON do Maps (só os índices que lemos).
function makeBizNode({ name, ftid, cats = ["Restaurante"], rating = 4.5, reviews = 100, phone = "(16) 3333-3333", addr = ["R. X, 1 - Centro", "São Carlos - SP", "13560-000"], site } = {}) {
  const node = new Array(260).fill(null);
  node[2] = addr;
  // nota e contagem de avaliações são adjacentes: info[4][7]=nota, info[4][8]=avaliações.
  node[4] = [null, null, null, null, null, null, null, rating, reviews];
  node[7] = site ? [`/url?q=${encodeURIComponent(site)}&opi=1`, site.replace(/^https?:\/\//, "").replace(/\/$/, "")] : null;
  node[9] = [null, null, -22.0, -47.9];
  node[10] = ftid;
  node[11] = name;
  node[13] = cats;
  node[37] = [null, 999999]; // isca: índice ANTIGO (errado) — garante que não voltamos a lê-lo
  node[178] = [[phone]];
  return node;
}

test("generateGrid: cobre a bbox em passos, sem drift de float", () => {
  const cells = generateGrid({ startLat: 0, startLng: 0, endLat: 0.1, endLng: 0.1, step: 0.04 });
  // ceil(0.1/0.04)=3 linhas x 3 colunas = 9 células
  assert.equal(cells.length, 9);
  assert.deepEqual(cells[0], { lat: 0, lng: 0 });
  // valores arredondados a 6 casas (sem 0.12000000000000001)
  assert.ok(cells.every((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng)));
});

test("generateGrid: step inválido lança erro", () => {
  assert.throws(() => generateGrid({ startLat: 0, startLng: 0, endLat: 1, endLng: 1, step: 0 }));
});

test("bboxFromCenter: centro + raio vira bounding box simétrica", () => {
  const box = bboxFromCenter({ lat: -22, lng: -47, areaSize: 0.05 });
  assert.deepEqual(box, { startLat: -22.05, startLng: -47.05, endLat: -21.95, endLng: -46.95 });
});

test("buildPbUrl: injeta coords/locale/termo e mantém a cauda fixa", () => {
  const url = buildPbUrl({ keyword: "café bar", lat: -22.01, lng: -47.89, locale: "pt-BR", gl: "br" });
  assert.match(url, /tbm=map/);
  assert.match(url, /hl=pt-BR&gl=br/);
  assert.match(url, /!2d-47\.89!3d-22\.01/);
  assert.match(url, /!7i120!10b1/); // limite + início da cauda
  assert.match(url, /q=caf%C3%A9%20bar$/);
});

test("unwrapSite: desembrulha o redirect /url?q=", () => {
  assert.equal(
    unwrapSite(["/url?q=https://exemplo.com.br/&opi=9&sa=U", "exemplo.com.br"]),
    "https://exemplo.com.br/"
  );
  // sem redirect: cai pro domínio de exibição
  assert.equal(unwrapSite([null, "loja.com"]), "https://loja.com");
  assert.equal(unwrapSite(null), "");
});

test("mapBusiness: mapeia índices do Maps para o lead cru", () => {
  const node = makeBizNode({
    name: "Bar do Zé",
    ftid: "0xabc:0xdef",
    cats: ["Bar", "Petiscaria"],
    rating: 4.7,
    reviews: 233,
    phone: "(16) 99999-0000",
    site: "https://barzé.com/",
  });
  const lead = mapBusiness(node);
  assert.equal(lead.nome, "Bar do Zé");
  assert.equal(lead.categoria, "Bar / Petiscaria");
  assert.equal(lead.nota, 4.7);
  assert.equal(lead.avaliacoes, 233);
  assert.equal(lead.telefone, "(16) 99999-0000");
  assert.equal(lead.endereco, "R. X, 1 - Centro, São Carlos - SP, 13560-000");
  assert.equal(lead.site_bruto, "https://barzé.com/");
  // ftid embutido no link => dedupe da pipeline funciona
  assert.match(lead.link_maps, /0xabc:0xdef/);
});

test("mapBusiness: nó sem nome retorna null", () => {
  assert.equal(mapBusiness([1, 2, 3]), null);
  assert.equal(mapBusiness(makeBizNode({ name: "", ftid: "0x1:0x2" })), null);
});

test("findBusinesses/parseMapsResponse: acha nós e remove prefixo XSSI", () => {
  const biz = makeBizNode({ name: "Loja A", ftid: "0x1:0x2" });
  // embrulha o nó dentro de uma árvore aninhada como na resposta real
  const tree = [["meta"], [[null, [biz]]], ["fim"]];
  const found = findBusinesses(tree, []);
  assert.equal(found.length, 1);
  assert.equal(found[0][11], "Loja A");

  const body = ")]}'\n" + JSON.stringify(tree);
  const leads = parseMapsResponse(body);
  assert.equal(leads.length, 1);
  assert.equal(leads[0].nome, "Loja A");
});

test("parseMapsResponse: corpo inválido/vazio não lança", () => {
  assert.deepEqual(parseMapsResponse(""), []);
  assert.deepEqual(parseMapsResponse(")]}'\nnão-é-json"), []);
});

test("scrape: deduplica o MESMO lugar entre células sobrepostas", async () => {
  // Duas células: a mesma loja (ftid igual) aparece nas duas; uma loja exclusiva por célula.
  const cellA = ")]}'\n" + JSON.stringify([[[null, [makeBizNode({ name: "Comum", ftid: "0xAA:0xBB" })]]], [[null, [makeBizNode({ name: "SóA", ftid: "0x11:0x22" })]]]]);
  const cellB = ")]}'\n" + JSON.stringify([[[null, [makeBizNode({ name: "Comum", ftid: "0xAA:0xBB" })]]], [[null, [makeBizNode({ name: "SóB", ftid: "0x33:0x44" })]]]]);
  let call = 0;
  const fetchImpl = async () => ({ ok: true, text: async () => (call++ === 0 ? cellA : cellB) });

  const scraper = new GoogleMapsGridScraper({ fetchImpl });
  const leads = await scraper.scrape({
    keyword: "lojas",
    bbox: { startLat: 0, startLng: 0, endLat: 0.05, endLng: 0.09 }, // 1x2 => 2 células
    step: 0.05,
    concurrency: 1,
  });
  const nomes = leads.map((l) => l.nome).sort();
  // "Comum" aparece uma única vez (deduplicado por ftid); SóA e SóB preservados.
  assert.deepEqual(nomes, ["Comum", "SóA", "SóB"]);
});

test("scrape: célula que falha (fetch lança) não derruba a varredura", async () => {
  let call = 0;
  const ok = ")]}'\n" + JSON.stringify([[[null, [makeBizNode({ name: "Viva", ftid: "0x9:0x9" })]]]]);
  const fetchImpl = async () => {
    if (call++ === 0) throw new Error("rede caiu");
    return { ok: true, text: async () => ok };
  };
  const scraper = new GoogleMapsGridScraper({ fetchImpl });
  const leads = await scraper.scrape({
    keyword: "x",
    bbox: { startLat: 0, startLng: 0, endLat: 0.05, endLng: 0.09 },
    step: 0.05,
    concurrency: 1,
  });
  assert.deepEqual(leads.map((l) => l.nome), ["Viva"]);
});
