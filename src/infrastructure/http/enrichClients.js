/**
 * Monta os clients de medição de CWV para uma requisição de enriquecimento.
 *
 * - modo rápido (padrão): PageSpeed só com `performance` (Lighthouse enxuto) +
 *   um CrUX client (dado de campo, tentado primeiro pelo caso de uso).
 * - modo profundo (`deep`): PageSpeed com as 4 categorias do Lighthouse e SEM
 *   CrUX (sempre roda o laboratório completo).
 *
 * Construtores são injetáveis para teste.
 */
import { PageSpeedClient, ALL_CATEGORIES } from "../pagespeed/PageSpeedClient.js";
import { CruxClient } from "../pagespeed/CruxClient.js";

export function buildEnrichClients({
  apiKey,
  lighthouseUrl,
  deep = false,
  strategy = "mobile",
  PageSpeedClientCtor = PageSpeedClient,
  CruxClientCtor = CruxClient,
} = {}) {
  const categories = deep ? ALL_CATEGORIES : ["performance"];
  const pageSpeed = new PageSpeedClientCtor({ apiKey, baseUrl: lighthouseUrl || "", categories, strategy });
  const crux = deep ? null : new CruxClientCtor({ apiKey });
  return { pageSpeed, crux, categories };
}
