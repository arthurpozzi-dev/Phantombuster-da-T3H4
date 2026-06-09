/**
 * Caso de uso: SEPARAÇÃO dos leads em duas listas — "com site" e "sem site".
 *
 * Regra-chave: o link do campo "site" do Google Maps só conta como site PRÓPRIO
 * se NÃO for uma rede social (Instagram, Facebook, X…) nem um agregador de links
 * (Linktree, bio.link…). Nesses casos o lead vai para "sem site" e o link é
 * registrado em `redes_sociais`.
 *
 * Função pura.
 */
import { isSocialOrAggregator } from "../domain/classification.js";

/** Junta o link social ao campo redes_sociais, sem duplicar. */
function addSocial(existing, url) {
  const parts = existing ? existing.split(" | ") : [];
  if (!parts.includes(url)) parts.push(url);
  return parts.filter(Boolean).join(" | ");
}

/**
 * @param {import("../domain/Lead.js").Lead[]} leads
 * @returns {{ comSite: import("../domain/Lead.js").Lead[], semSite: import("../domain/Lead.js").Lead[] }}
 */
export function splitLeads(leads = []) {
  const comSite = [];
  const semSite = [];

  for (const lead of leads) {
    const candidato = lead.site_bruto;

    if (candidato && !isSocialOrAggregator(candidato)) {
      // Site próprio de verdade.
      comSite.push({ ...lead, site: candidato });
    } else {
      // Sem site próprio: se o candidato for rede social/agregador, guarda em redes_sociais.
      const redes = candidato
        ? addSocial(lead.redes_sociais, candidato)
        : lead.redes_sociais;
      semSite.push({ ...lead, site: "", redes_sociais: redes });
    }
  }

  return { comSite, semSite };
}
