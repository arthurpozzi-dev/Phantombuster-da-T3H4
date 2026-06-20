/**
 * CLI da busca por GRID (Estratégia A — endpoint JSON, sem navegador).
 *
 * Varre uma região inteira para um termo, quebrando o limite de ~120 do Maps,
 * passa os leads crus pelo MESMO pipeline do servidor (limpeza → filtro → split)
 * e grava o resultado em JSON.
 *
 * Uso:
 *   node scripts/gridScrape.js --keyword "restaurantes" --lat -22.0175 --lng -47.8908
 *   node scripts/gridScrape.js -k "petshop" --lat -23.5505 --lng -46.6333 --area 0.06 --step 0.03
 *   node scripts/gridScrape.js -k "academia" --bbox -22.06,-47.94,-21.97,-47.84 --out leads.json
 *
 * Flags:
 *   --keyword, -k   termo de busca (obrigatório)
 *   --lat --lng     centro da varredura
 *   --area          raio em graus a partir do centro (padrão 0.05 ≈ 5,5 km)
 *   --bbox          "startLat,startLng,endLat,endLng" (alternativa a lat/lng/area)
 *   --step          passo da grade em graus (padrão 0.04 ≈ 4 km; menor = mais células)
 *   --max           teto de leads (0 = todos)
 *   --conc          requisições simultâneas (padrão 4)
 *   --minAval --maxAval --notaMin   filtro de reputação (mesmos do servidor)
 *   --out           arquivo de saída JSON (padrão grid-leads.json)
 */
import { writeFileSync } from "node:fs";
import { GoogleMapsGridScraper } from "../src/infrastructure/scraper/GoogleMapsGridScraper.js";
import { runPipeline } from "../src/application/runPipeline.js";

function parseArgs(argv) {
  const args = {};
  const alias = { k: "keyword", o: "out" };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith("-")) continue;
    const key = alias[tok.replace(/^-+/, "")] || tok.replace(/^-+/, "");
    const next = argv[i + 1];
    // Um valor segue a flag, a menos que o próximo token seja outra flag. Números
    // negativos (ex.: -22.0175) começam com "-" mas SÃO valores, não flags.
    const nextIsFlag = next !== undefined && next.startsWith("-") && !/^-?\d*\.?\d+/.test(next);
    if (next === undefined || nextIsFlag) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const keyword = typeof a.keyword === "string" ? a.keyword : "";
  if (!keyword) {
    console.error('Erro: informe --keyword "termo de busca". Veja o cabeçalho do arquivo para exemplos.');
    process.exit(1);
  }

  let bbox;
  let center;
  if (typeof a.bbox === "string") {
    const [sLat, sLng, eLat, eLng] = a.bbox.split(",").map(num);
    if ([sLat, sLng, eLat, eLng].some((v) => v === undefined)) {
      console.error("Erro: --bbox deve ser 'startLat,startLng,endLat,endLng'.");
      process.exit(1);
    }
    bbox = { startLat: sLat, startLng: sLng, endLat: eLat, endLng: eLng };
  } else {
    const lat = num(a.lat);
    const lng = num(a.lng);
    if (lat === undefined || lng === undefined) {
      console.error("Erro: informe --lat e --lng (ou --bbox).");
      process.exit(1);
    }
    center = { lat, lng };
  }

  const areaSize = num(a.area) ?? 0.05;
  const step = num(a.step) ?? 0.04;
  const maxResults = num(a.max) ?? 0;
  const concurrency = num(a.conc) ?? 4;
  const out = typeof a.out === "string" ? a.out : "grid-leads.json";

  const filterOptions = {};
  if (num(a.minAval) !== undefined) filterOptions.minAvaliacoes = num(a.minAval);
  if (num(a.maxAval) !== undefined) filterOptions.maxAvaliacoes = num(a.maxAval);
  if (num(a.notaMin) !== undefined) filterOptions.notaMin = num(a.notaMin);

  const scraper = new GoogleMapsGridScraper();
  const t0 = Date.now();
  const raw = await scraper.scrape({
    keyword,
    bbox,
    center,
    areaSize,
    step,
    maxResults,
    concurrency,
    onProgress: (p) => {
      if (p.message) process.stdout.write(`\r${p.message.padEnd(80)}`);
    },
  });
  process.stdout.write("\n");

  const { comSite, semSite, stats } = runPipeline(raw, filterOptions);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  console.log("\n===== RESULTADO (grid) =====");
  console.log(`termo:        ${keyword}`);
  console.log(`tempo:        ${secs}s`);
  console.log(`crus (únicos):${String(raw.length).padStart(6)}`);
  console.log(`após filtro:  ${String(stats.filtrados).padStart(6)}`);
  console.log(`com site:     ${String(stats.comSite).padStart(6)}`);
  console.log(`sem site:     ${String(stats.semSite).padStart(6)}`);

  writeFileSync(out, JSON.stringify({ keyword, stats, comSite, semSite }, null, 2));
  console.log(`\nSalvo em ${out}`);
}

main().catch((err) => {
  console.error("\nFalha:", err.message);
  process.exit(1);
});
