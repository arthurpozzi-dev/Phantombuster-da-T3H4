/**
 * Testes das funções puras do pipeline (sem rede/browser).
 * Roda com: npm test  (usa o test runner nativo do Node).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { cleanLeads } from "../src/application/CleanLeads.js";
import { filterLeads } from "../src/application/FilterLeads.js";
import { splitLeads } from "../src/application/SplitLeads.js";
import { enrichLeads } from "../src/application/EnrichLeads.js";
import { toWhatsAppLink, parseReviews, parseRating } from "../src/domain/Lead.js";
import { isSocialOrAggregator, classifyCwv } from "../src/domain/classification.js";
import { detectErrorPage } from "../src/infrastructure/scraper/SiteHealthChecker.js";
import { extractEmails, decodeCloudflareEmails, isJunkEmail } from "../src/infrastructure/scraper/SiteTextScraper.js";
import { findContactLinks, urlVariants } from "../src/infrastructure/scraper/EmailScraper.js";

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

const mapsUrl = (id, extra = "") =>
  `https://www.google.com/maps/place/Lugar/@-19.9,-43.9,17z/data=!3m1!4b1!4m6!1s${id}!8m2${extra}`;

test("limpeza: junta duplicatas pelo place-id (mesmo lugar, URLs diferentes)", () => {
  const raw = [
    { nome: "Clínica X", telefone: "(31) 3333-0000", link_maps: mapsUrl("0xabc123:0xdef456", "&q=1") },
    { nome: "Clínica X", site: "https://x.com", link_maps: mapsUrl("0xabc123:0xdef456", "&q=2") },
  ];
  const out = cleanLeads(raw);
  assert.equal(out.length, 1); // mesmo place-id => 1 lead
  assert.equal(out[0].telefone, "(31) 3333-0000");
  assert.equal(out[0].site_bruto, "https://x.com"); // mesclou os campos vazios
});

test("limpeza: lugares com place-id diferente NÃO se fundem (mesmo nome)", () => {
  const raw = [
    { nome: "Cacau Show", telefone: "(31) 3333-1111", link_maps: mapsUrl("0xaaa:0x111") },
    { nome: "Cacau Show", telefone: "(31) 3333-2222", link_maps: mapsUrl("0xbbb:0x222") },
    { nome: "Cacau Show", link_maps: mapsUrl("0xccc:0x333") }, // sem telefone, outro lugar
  ];
  assert.equal(cleanLeads(raw).length, 3); // três unidades distintas
});

test("limpeza: NÃO descarta leads sem avaliação/contato (só deduplica)", () => {
  const raw = [
    { nome: "So Nome", link_maps: mapsUrl("0x1:0x1") },
    { nome: "", link_maps: mapsUrl("0x2:0x2") }, // até sem nome é mantido
  ];
  assert.equal(cleanLeads(raw).length, 2);
});

test("filtro: leads sem avaliação só entram quando mín = 0", () => {
  const semReview = cleanLeads([
    { nome: "Novo Negócio", telefone: "(16) 99999-7777" }, // sem nota/avaliações
    { nome: "Com Review", nota: "4,5", avaliacoes: "20", telefone: "(16) 99999-8888" },
  ]);
  // Padrão (mín 5): o sem review fica de fora.
  assert.deepEqual(filterLeads(semReview).map((l) => l.nome), ["Com Review"]);
  // Mín = 0: o sem review entra.
  const comZero = filterLeads(semReview, { minAvaliacoes: 0, notaMin: 0 }).map((l) => l.nome);
  assert.ok(comZero.includes("Novo Negócio") && comZero.includes("Com Review"));
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

test("extração de e-mails (mailto, texto, ofuscado; ignora assets)", () => {
  const html = `
    <a class="btn" href="mailto:Contato@Empresa.com.br?subject=Oi">Fale conosco</a>
    <p>Ou escreva para vendas@empresa.com.br</p>
    <span>suporte [at] empresa [dot] com</span>
    <img src="logo@2x.png">
    <a href="mailto:contato@empresa.com.br">repetido</a>`;
  const emails = extractEmails(html);
  assert.ok(emails.includes("contato@empresa.com.br"));   // mailto, minúsculo, sem ?subject
  assert.ok(emails.includes("vendas@empresa.com.br"));    // texto puro
  assert.ok(emails.includes("suporte@empresa.com"));      // desofuscado [at]/[dot]
  assert.ok(!emails.some((e) => e.includes("2x.png")));    // asset ignorado
  assert.equal(new Set(emails).size, emails.length);       // sem duplicatas
});

test("extração de e-mails: descarta placeholders e telemetria (Sentry/Wix)", () => {
  // Lixo: deve ser barrado.
  assert.ok(isJunkEmail("email@example.com"));
  assert.ok(isJunkEmail("contato@seudominio.com.br"));
  assert.ok(isJunkEmail("c183baa23371454f99f417f6616b724d@sentry.wixpress.com"));
  assert.ok(isJunkEmail("abc@sentry.io"));
  assert.ok(isJunkEmail("noreply@padaria.com.br"));      // no-reply
  assert.ok(isJunkEmail("nao-responda@loja.com"));       // não responda
  assert.ok(isJunkEmail("suporte@wix.com"));             // plataforma
  assert.ok(isJunkEmail("info@checkout.shopify.com"));   // subdomínio de plataforma
  // Real: deve passar.
  assert.ok(!isJunkEmail("contato@restaurante.com.br"));
  assert.ok(!isJunkEmail("joao@padaria.com"));
  assert.ok(!isJunkEmail("reply@empresa.com"));          // "reply" sozinho não é no-reply

  const html = `
    <p>email@example.com</p>
    <a href="mailto:c183baa23371454f99f417f6616b724d@sentry.wixpress.com">erro</a>
    <p>Fale com a gente: contato@restaurante.com.br</p>`;
  const emails = extractEmails(html);
  assert.deepEqual(emails, ["contato@restaurante.com.br"]);
});

test("extração de e-mails: decodifica Cloudflare email-protection", () => {
  // Codifica "contato@empresa.com" no formato do Cloudflare (1º byte = chave XOR).
  const enc = (email, key = 0x3f) => {
    let h = key.toString(16).padStart(2, "0");
    for (const c of email) h += (c.charCodeAt(0) ^ key).toString(16).padStart(2, "0");
    return h;
  };
  const html =
    `<span class="__cf_email__" data-cfemail="${enc("contato@empresa.com")}">[email protected]</span>` +
    `<a href="/cdn-cgi/l/email-protection#${enc("vendas@empresa.com")}">e-mail</a>`;

  assert.deepEqual(decodeCloudflareEmails(html).sort(), ["contato@empresa.com", "vendas@empresa.com"]);
  // E o decode também entra no resultado geral de extractEmails:
  assert.ok(extractEmails(html).includes("contato@empresa.com"));
});

test("descoberta de links de contato: mesmo domínio, só pistas conhecidas", () => {
  const html = `
    <a href="/">Home</a>
    <a href="/contato">Contato</a>
    <a href="sobre-nos.html">Sobre</a>
    <a href="https://www.exemplo.com.br/fale-conosco">Fale</a>
    <a href="https://outro.com/contato">Externo</a>
    <a href="mailto:x@y.com">mail</a>
    <a href="/produtos">Produtos</a>`;
  const links = findContactLinks(html, "exemplo.com.br");
  assert.ok(links.includes("https://exemplo.com.br/contato"));
  assert.ok(links.includes("https://exemplo.com.br/sobre-nos.html"));
  assert.ok(links.includes("https://www.exemplo.com.br/fale-conosco")); // www = mesmo site
  assert.ok(!links.some((u) => u.includes("outro.com")));               // domínio externo fora
  assert.ok(!links.some((u) => u.includes("/produtos")));               // sem pista de contato
});

test("variantes de URL: alterna www/apex e cai para http", () => {
  const v = urlVariants("exemplo.com.br");
  assert.equal(v[0], "https://exemplo.com.br");
  assert.ok(v.some((u) => u.startsWith("https://www.exemplo.com.br")));
  assert.ok(v.some((u) => u.startsWith("http://")));
});

test("detecção de página de erro (soft 404 / parqueada)", () => {
  assert.ok(detectErrorPage("<html><head><title>Página não encontrada</title></head><body>x</body></html>"));
  assert.ok(detectErrorPage("<html><body><h1>Erro 404</h1></body></html>"));
  assert.ok(detectErrorPage("<title>Buy this domain</title>"));
  // Página normal não é marcada como erro:
  assert.equal(detectErrorPage("<title>Clínica X - Estética</title><body>" + "Serviços e contato. ".repeat(200) + "</body>"), null);
});

test("enriquecimento: site fora do ar vira FORA DO AR e não chama o PageSpeed", async () => {
  let psiChamado = false;
  const psiFake = { analyze: async () => { psiChamado = true; return { score: 99 }; } };
  const checkerFake = { check: async () => ({ down: true, reason: "HTTP 404" }) };
  const { leads, ok, foraDoAr } = await enrichLeads(
    [{ nome: "Site Morto", site: "https://morto.com" }],
    psiFake,
    undefined,
    { healthChecker: checkerFake, concurrency: 1 }
  );
  assert.equal(psiChamado, false);          // não desperdiça chamada no site morto
  assert.equal(leads[0].cwv_status, "FORA DO AR");
  assert.equal(leads[0].cwv_score, null);
  assert.equal(ok, 0);
  assert.equal(foraDoAr, 1);
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
