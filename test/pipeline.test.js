/**
 * Testes das funções puras do pipeline (sem rede/browser).
 * Roda com: npm test  (usa o test runner nativo do Node).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { cleanLeads } from "../src/application/CleanLeads.js";
import { filterLeads } from "../src/application/FilterLeads.js";
import { splitLeads } from "../src/application/SplitLeads.js";
import { toWhatsAppLink, parseReviews, parseRating } from "../src/domain/Lead.js";
import { isSocialOrAggregator, classifyCwv } from "../src/domain/classification.js";

test("parse de nota e avaliações em PT-BR", () => {
  assert.equal(parseRating("4,7"), 4.7);
  assert.equal(parseReviews("(1.234)"), 1234);
  assert.equal(parseReviews("98 avaliações"), 98);
});

test("WhatsApp só para celular BR", () => {
  assert.equal(toWhatsAppLink("(16) 99999-8888"), "https://wa.me/5516999998888");
  assert.equal(toWhatsAppLink("(16) 3333-4444"), ""); // fixo -> sem whatsapp
});

test("classificação de site social vs próprio", () => {
  assert.equal(isSocialOrAggregator("https://instagram.com/loja"), true);
  assert.equal(isSocialOrAggregator("https://linktr.ee/loja"), true);
  assert.equal(isSocialOrAggregator("https://www.minhaempresa.com.br"), false);
});

test("classificação Core Web Vitals", () => {
  assert.equal(classifyCwv(95), "BOM");
  assert.equal(classifyCwv(70), "MÉDIO");
  assert.equal(classifyCwv(30), "RUIM");
});

test("limpeza: remove vazios e junta duplicatas", () => {
  const raw = [
    { nome: "A", telefone: "(16) 99999-0000", link_maps: "https://maps/a" },
    { nome: "A", site: "https://a.com", link_maps: "https://maps/a" }, // duplicata por link_maps
    { nome: "", telefone: "" }, // vazio -> descartado
    { nome: "Sem contato" }, // sem contato -> descartado
  ];
  const out = cleanLeads(raw);
  assert.equal(out.length, 1);
  assert.equal(out[0].nome, "A");
  assert.equal(out[0].site_bruto, "https://a.com"); // mesclou o campo vazio
});

test("limpeza: junta duplicatas pelo nome mesmo com link_maps diferente", () => {
  const raw = [
    { nome: "Padaria São José", telefone: "(16) 99999-0000", link_maps: "https://maps/?q=1&data=abc" },
    { nome: "padaria sao jose", site: "https://psj.com", link_maps: "https://maps/?q=2&data=xyz" },
    { nome: "PADARIA SÃO JOSÉ ", link_maps: "https://maps/?q=3" },
  ];
  const out = cleanLeads(raw);
  assert.equal(out.length, 1); // os três são o mesmo lugar
  assert.equal(out[0].telefone, "(16) 99999-0000");
  assert.equal(out[0].site_bruto, "https://psj.com"); // mesclou de outra ocorrência
});

test("limpeza: nomes diferentes não são fundidos", () => {
  const raw = [
    { nome: "Padaria Centro", telefone: "(16) 99999-1111" },
    { nome: "Padaria Bairro", telefone: "(16) 99999-2222" },
  ];
  assert.equal(cleanLeads(raw).length, 2);
});

test("filtro: faixa de avaliações e nota mínima", () => {
  const leads = cleanLeads([
    { nome: "Bom", nota: "4,5", avaliacoes: "50", telefone: "(16) 99999-1111" },
    { nome: "Poucas", nota: "5", avaliacoes: "3", telefone: "(16) 99999-2222" },
    { nome: "Muitas", nota: "4,8", avaliacoes: "500", telefone: "(16) 99999-3333" },
    { nome: "Nota baixa", nota: "3,2", avaliacoes: "40", telefone: "(16) 99999-4444" },
  ]);
  const out = filterLeads(leads); // padrão: 5–100 avaliações, nota >= 4
  assert.deepEqual(out.map((l) => l.nome), ["Bom"]);
});

test("separação: social vai para sem-site e entra em redes_sociais", () => {
  const leads = cleanLeads([
    { nome: "ComSite", site: "https://empresa.com.br", telefone: "(16) 99999-1111" },
    { nome: "SoInsta", site: "https://instagram.com/empresa", telefone: "(16) 99999-2222" },
    { nome: "SemNada", telefone: "(16) 99999-3333" },
  ]);
  const { comSite, semSite } = splitLeads(leads);
  assert.deepEqual(comSite.map((l) => l.nome), ["ComSite"]);
  assert.equal(comSite[0].site, "https://empresa.com.br");
  const soInsta = semSite.find((l) => l.nome === "SoInsta");
  assert.equal(soInsta.site, "");
  assert.ok(soInsta.redes_sociais.includes("instagram.com/empresa"));
});
