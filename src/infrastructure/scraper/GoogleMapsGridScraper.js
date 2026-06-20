/**
 * Adaptador de coleta: Google Maps via GRID + endpoint JSON interno (sem navegador).
 *
 * Por que existe: o feed do Google Maps trava em ~120 resultados por viewport.
 * Esse limite é POR ÁREA — então, em vez de uma única busca, dividimos uma
 * região (bounding box) em várias células lat/lng e rodamos a busca centrada em
 * cada uma. Cada célula devolve até ~120 e a união deduplicada por place-id
 * (ftid) rende milhares. (Técnica portada do projeto GMapsHunter.)
 *
 * Como coleta: bate direto no endpoint `google.com/search?tbm=map&pb=...`, que
 * devolve um JSON cru (o mesmo que o front do Maps consome). Não usa Playwright
 * — é HTTP puro (`fetch`), muito mais rápido e leve que abrir o Chromium célula
 * a célula. Validado respondendo 200 sem proxy/TLS-impersonation; se um dia o
 * Google passar a exigir, dá pra injetar `fetchImpl`/`userAgent` pelo construtor.
 *
 * Responsabilidade ÚNICA: navegar a grade e devolver leads CRUS no MESMO formato
 * do GoogleMapsScraper (nome, categoria, nota, avaliacoes, telefone, endereco,
 * site_bruto, redes_sociais, descricao, link_maps). Toda normalização/filtro fica
 * nas camadas de domínio/aplicação — este arquivo não conhece regras de negócio.
 *
 * Os índices do JSON do Maps (info[11]=nome, info[10]=ftid, info[4][7]=nota,
 * info[37][1]=avaliações, info[178][0][0]=telefone, info[7]=site, info[2]=endereço,
 * info[13]=categorias) podem mudar se o Google alterar o formato.
 */
import { runPool } from "../../application/concurrentPool.js";
import { extractPlaceId } from "../../domain/Lead.js";

/** User-Agent padrão (Chrome desktop). Pode ser sobrescrito no construtor. */
const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/**
 * Cauda fixa do parâmetro `pb` do Maps (flags de quais blocos de dados pedir).
 * Mantida verbatim do GMapsHunter — encurtá-la faz o endpoint devolver vazio.
 * O cabeçalho (zoom/coords/limite) é montado dinamicamente em {@link buildPbUrl}.
 */
const PB_TAIL =
  "!12m25!1m5!18b1!30b1!31m1!1b1!34e1!2m4!5m1!6e2!20e3!39b1!10b1!12b1!13b1!16b1!17m1!3e1!20m3!5e2!6b1!14b1!46m1!1b0!96b1!99b1!19m4!2m3!1i360!2i120!4i8" +
  "!20m65!2m2!1i203!2i100!3m2!2i4!5b1!6m6!1m2!1i86!2i86!1m2!1i408!2i240" +
  "!7m33!1m3!1e1!2b0!3e3!1m3!1e2!2b1!3e2!1m3!1e2!2b0!3e3!1m3!1e8!2b0!3e3!1m3!1e10!2b0!3e3!1m3!1e10!2b1!3e2!1m3!1e10!2b0!3e4!1m3!1e9!2b1!3e2!2b1!9b0" +
  "!15m16!1m7!1m2!1m1!1e2!2m2!1i195!2i195!3i20!1m7!1m2!1m1!1e2!2m2!1i195!2i195!3i20" +
  "!24m107!1m30!13m9!2b1!3b1!4b1!6i1!8b1!9b1!14b1!20b1!25b1!18m19!3b1!4b1!5b1!6b1!9b1!13b1!14b1!17b1!20b1!21b1!22b1!27m1!1b0!28b0!32b1!33m1!1b1!34b1!36e2!10m1!8e3!11m1!3e1!14m1!3b0!17b1!20m2!1e3!1e6!24b1!25b1!26b1!27b1!29b1!30m1!2b1!36b1!37b1!39m3!2m2!2i1!3i1!43b1!52b1!55b1!56m1!1b1!61m2!1m1!1e1!65m5!3m4!1m3!1m2!1i224!2i298!72m22!1m8!2b1!5b1!7b1!12m4!1b1!2b1!4m1!1e1!4b1!8m10!1m6!4m1!1e1!4m1!1e3!4m1!1e4!3sother_user_google_review_posts__and__hotel_and_vr_partner_review_posts!6m1!1e1!9b1!89b1!98m3!1b1!2b1!3b1!103b1!113b1!114m3!1b1!2m1!1b1!117b1!122m1!1b1!126b1!127b1" +
  "!26m4!2m3!1i80!2i92!4i8" +
  "!30m28!1m6!1m2!1i0!2i0!2m2!1i530!2i827!1m6!1m2!1i1462!2i0!2m2!1i1512!2i827!1m6!1m2!1i0!2i0!2m2!1i1512!2i20!1m6!1m2!1i0!2i807!2m2!1i1512!2i827" +
  "!34m19!2b1!3b1!4b1!6b1!8m6!1b1!3b1!4b1!5b1!6b1!7b1!9b1!12b1!14b1!20b1!23b1!25b1!26b1!31b1" +
  "!37m1!1e81!42b1!47m0!49m10!3b1!6m2!1b1!2b1!7m2!1e3!2b1!8b1!9b1!10e2" +
  "!50m4!2e2!3m2!1b1!3b1" +
  "!67m5!7b1!10b1!14b1!15m1!1b0!69i760";

/**
 * Monta a URL do endpoint JSON do Maps para uma busca centrada em (lat, lng).
 * @param {Object} p
 * @param {string} p.keyword     termo de busca (ex.: "restaurantes")
 * @param {number} p.lat
 * @param {number} p.lng
 * @param {number|string} p.zoomMeters  "raio" do viewport (1d). Padrão 4500.
 * @param {number} p.limit       máx. de resultados por célula (7i). Padrão 120.
 * @param {string} p.locale      hl (idioma). Padrão "pt-BR".
 * @param {string} p.gl          país. Padrão "br".
 * @returns {string} URL pronta para fetch.
 */
export function buildPbUrl({ keyword, lat, lng, zoomMeters = 4500, limit = 120, locale = "pt-BR", gl = "br" }) {
  const head =
    `!4m12!1m3!1d${zoomMeters}!2d${lng}!3d${lat}` +
    `!2m3!1f0!2f0!3f0!3m2!1i1512!2i827!4f13.1!7i${limit}!10b1`;
  const pb = head + PB_TAIL;
  return (
    `https://www.google.com/search?tbm=map&authuser=0&hl=${locale}&gl=${gl}` +
    `&pb=${pb}&q=${encodeURIComponent(keyword)}`
  );
}

/**
 * Gera os centros das células de uma bounding box, em passos de `step` graus.
 * Iteração por contagem (não acumulando floats) para evitar drift de ponto
 * flutuante. ~0.04° ≈ 4 km; ~0.02° ≈ 2 km.
 * @param {Object} box  { startLat, startLng, endLat, endLng, step }
 * @returns {Array<{lat:number,lng:number}>}
 */
export function generateGrid({ startLat, startLng, endLat, endLng, step = 0.04 }) {
  if (!(step > 0)) throw new Error("step deve ser > 0");
  const round6 = (n) => Math.round(n * 1e6) / 1e6;
  const rows = Math.max(0, Math.ceil((endLat - startLat) / step));
  const cols = Math.max(0, Math.ceil((endLng - startLng) / step));
  const cells = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      cells.push({ lat: round6(startLat + r * step), lng: round6(startLng + c * step) });
  return cells;
}

/** Converte um centro + "raio" em graus numa bounding box. */
export function bboxFromCenter({ lat, lng, areaSize = 0.05 }) {
  return { startLat: lat - areaSize, startLng: lng - areaSize, endLat: lat + areaSize, endLng: lng + areaSize };
}

/** Acesso seguro a um caminho aninhado (equiv. ao safe_get do GMapsHunter). */
function safeGet(node, path) {
  let cur = node;
  for (const i of path) {
    if (cur == null) return undefined;
    cur = cur[i];
  }
  return cur;
}

/**
 * Desembrulha o link de site, que vem como redirect do Google
 * (`/url?q=<URL_REAL>&...`). Cai para o domínio de exibição se não achar o `q`.
 * @param {any} siteArr  info[7]
 * @returns {string} URL do site, ou "".
 */
export function unwrapSite(siteArr) {
  if (!Array.isArray(siteArr)) return "";
  const redirect = siteArr[0];
  if (typeof redirect === "string") {
    const m = redirect.match(/[?&]q=([^&]+)/);
    if (m) {
      try {
        return decodeURIComponent(m[1]);
      } catch {
        return m[1];
      }
    }
    if (/^https?:\/\//i.test(redirect)) return redirect;
  }
  const display = siteArr[1];
  return typeof display === "string" && display ? `https://${display}` : "";
}

/**
 * Mapeia um nó de negócio do JSON do Maps para o lead CRU do projeto.
 * @param {any[]} info
 * @returns {Record<string, any> | null}  null se não tiver nome.
 */
export function mapBusiness(info) {
  const nome = safeGet(info, [11]);
  if (typeof nome !== "string" || !nome.trim()) return null;

  const ftid = safeGet(info, [10]);
  const cats = safeGet(info, [13]);
  const rating = safeGet(info, [4, 7]);
  // Contagem de avaliações (o "(N)" ao lado das estrelas): o Google passou a
  // entregá-la em info[37][1]. O antigo info[4][8] hoje vem VAZIO — info[4] só
  // traz a nota em [4][7] — então fica só como fallback defensivo se o formato
  // variar. Ler de info[4][8] esvaziava avaliacoes e o filtro padrão (mín. 5)
  // descartava 100% dos leads.
  const reviews = safeGet(info, [37, 1]) ?? safeGet(info, [4, 8]);
  const phone = safeGet(info, [178, 0, 0]);
  const addrParts = safeGet(info, [2]);

  return {
    nome,
    categoria: Array.isArray(cats) ? cats.filter(Boolean).join(" / ") : "",
    nota: typeof rating === "number" ? rating : "",
    avaliacoes: typeof reviews === "number" ? reviews : "",
    telefone: typeof phone === "string" ? phone : "",
    endereco: Array.isArray(addrParts) ? addrParts.filter(Boolean).join(", ") : "",
    site_bruto: unwrapSite(safeGet(info, [7])),
    redes_sociais: "",
    descricao: "",
    // ftid embutido no link => o dedupe existente (extractPlaceId) funciona sem
    // tocar na pipeline; `?ftid=` é um deep link que o Maps resolve no clique.
    link_maps: typeof ftid === "string" && ftid ? `https://www.google.com/maps?ftid=${ftid}` : "",
  };
}

/**
 * Varre recursivamente o JSON procurando nós de negócio pela FORMA
 * (índice 11 = nome string, índice 13 = lista de categorias). Porta direta do
 * `_recursive_search` do GMapsHunter: tenta o nó embrulhado em [14] e o nó
 * direto. Para de descer assim que reconhece um negócio.
 * @param {any} data
 * @param {any[]} out  acumulador (mutado)
 */
export function findBusinesses(data, out = []) {
  if (!Array.isArray(data)) return out;

  const looksLikeBiz = (node) =>
    Array.isArray(node) &&
    node.length > 14 &&
    typeof node[11] === "string" &&
    Array.isArray(node[13]) &&
    node[13].length > 0;

  const inner = data.length > 14 ? data[14] : undefined;
  if (looksLikeBiz(inner)) {
    out.push(inner);
    return out;
  }
  if (looksLikeBiz(data)) {
    out.push(data);
    return out;
  }
  for (const item of data) findBusinesses(item, out);
  return out;
}

/**
 * Faz o parse de uma resposta do endpoint: remove o prefixo XSSI `)]}'`,
 * decodifica o JSON e mapeia os negócios encontrados para leads crus.
 * @param {string} text  corpo da resposta
 * @returns {Array<Record<string, any>>}
 */
export function parseMapsResponse(text) {
  const clean = (text || "").replace(/^\)\]\}'/, "").trim();
  if (!clean) return [];
  let data;
  try {
    data = JSON.parse(clean);
  } catch {
    return [];
  }
  const nodes = findBusinesses(data, []);
  const leads = [];
  for (const node of nodes) {
    const lead = mapBusiness(node);
    if (lead) leads.push(lead);
  }
  return leads;
}

/** Chave de dedupe entre células: place-id (ftid) ou nome+telefone normalizados. */
function dedupeKey(lead) {
  const pid = extractPlaceId(lead.link_maps);
  if (pid) return pid;
  const nome = (lead.nome || "").toLowerCase().replace(/\s+/g, " ").trim();
  const tel = (lead.telefone || "").replace(/\D/g, "");
  return `${nome}|${tel}`;
}

/**
 * Adaptador de scraping por grid do Google Maps (endpoint JSON, sem navegador).
 */
export class GoogleMapsGridScraper {
  /**
   * @param {Object} [options]
   * @param {string} [options.locale="pt-BR"]
   * @param {string} [options.gl="br"]
   * @param {number} [options.zoomMeters=4500]  "raio" do viewport por célula (1d)
   * @param {number} [options.limit=120]         máx. por célula (7i)
   * @param {string} [options.userAgent]
   * @param {typeof fetch} [options.fetchImpl]   injeta um fetch (testes/proxy)
   */
  constructor({ locale = "pt-BR", gl = "br", zoomMeters = 4500, limit = 120, userAgent = DEFAULT_UA, fetchImpl } = {}) {
    this.locale = locale;
    this.gl = gl;
    this.zoomMeters = zoomMeters;
    this.limit = limit;
    this.userAgent = userAgent;
    this.fetchImpl = fetchImpl || globalThis.fetch;
    if (typeof this.fetchImpl !== "function") {
      throw new Error("fetch indisponível: rode em Node >= 18 ou injete options.fetchImpl.");
    }
  }

  /**
   * Busca por grid uma região inteira para um termo.
   *
   * Aceita uma bounding box explícita OU um centro + raio (areaSize). Cada
   * célula vira uma requisição; os resultados são deduplicados por place-id
   * entre células. O retorno tem o MESMO formato do GoogleMapsScraper.scrape().
   *
   * @param {Object} opts
   * @param {string} opts.keyword            termo de busca
   * @param {{startLat:number,startLng:number,endLat:number,endLng:number}} [opts.bbox]
   * @param {{lat:number,lng:number}} [opts.center]   alternativa a bbox
   * @param {number} [opts.areaSize=0.05]     raio em graus quando se usa center
   * @param {number} [opts.step=0.04]         passo da grade em graus
   * @param {number} [opts.maxResults=0]      teto de resultados (0 = todos)
   * @param {number} [opts.concurrency=4]     requisições simultâneas
   * @param {number} [opts.timeoutMs=20000]   timeout por célula
   * @param {(p:any)=>void} [opts.onProgress]
   * @returns {Promise<Array<Record<string, any>>>} leads crus deduplicados.
   */
  async scrape({ keyword, bbox, center, areaSize = 0.05, step = 0.04, maxResults = 0, concurrency = 4, timeoutMs = 20000, onProgress }) {
    if (!keyword || !keyword.trim()) throw new Error("Informe um termo de busca (keyword).");
    const box = bbox || (center ? bboxFromCenter({ ...center, areaSize }) : null);
    if (!box) throw new Error("Informe uma bounding box (bbox) ou um centro (center).");

    const progress = (p) => onProgress?.(p);
    const cells = generateGrid({ ...box, step });
    progress({ phase: "grid", message: `Grade gerada: ${cells.length} célula(s).`, totalCells: cells.length });

    const byId = new Map();

    await runPool(cells, {
      concurrency,
      task: async (cell) => {
        const url = buildPbUrl({
          keyword,
          lat: cell.lat,
          lng: cell.lng,
          zoomMeters: this.zoomMeters,
          limit: this.limit,
          locale: this.locale,
          gl: this.gl,
        });
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
          const res = await this.fetchImpl(url, {
            headers: { "User-Agent": this.userAgent, "Accept-Language": this.locale },
            signal: ctrl.signal,
          });
          if (!res.ok) return [];
          return parseMapsResponse(await res.text());
        } catch {
          // Uma célula que falha (timeout/rede) não derruba a varredura.
          return [];
        } finally {
          clearTimeout(t);
        }
      },
      onDone: (done, total, cell, leads) => {
        for (const lead of leads || []) {
          const key = dedupeKey(lead);
          if (!byId.has(key)) byId.set(key, lead);
        }
        progress({
          phase: "scroll",
          message: `Célula ${done}/${total} (${cell.lat.toFixed(4)}, ${cell.lng.toFixed(4)}) — ${byId.size} únicos.`,
          current: done,
          total,
          found: byId.size,
        });
      },
    });

    let out = [...byId.values()];
    if (maxResults && out.length > maxResults) out = out.slice(0, maxResults);
    progress({ phase: "done", message: `Coleta por grid concluída: ${out.length} leads únicos.`, found: out.length });
    return out;
  }
}
