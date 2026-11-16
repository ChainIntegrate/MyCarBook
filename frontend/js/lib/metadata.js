// Lettura difensiva del JSON LSP4Metadata di un veicolo (audit MCB-11,
// MCB-01): qualunque campo di tipo inatteso viene ignorato invece di
// rompere la lista. Un token "spinto" da terzi con dati malformati non può
// bloccare la visualizzazione degli altri veicoli.
import { isSafeIpfsUri } from "./ipfs.js";

const MAX_TEXT = 200;

function cleanText(v) {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return s ? s.slice(0, MAX_TEXT) : null;
}

export function sanitizeVehicleMetadata(json) {
  const lsp4 = json && typeof json === "object" && json.LSP4Metadata && typeof json.LSP4Metadata === "object"
    ? json.LSP4Metadata
    : {};
  const attributes = Array.isArray(lsp4.attributes)
    ? lsp4.attributes
        .filter((a) => a && typeof a === "object")
        .map((a) => ({ key: cleanText(a.key), value: cleanText(a.value) }))
        .filter((a) => a.key && a.value)
        .slice(0, 10)
    : [];
  const iconUrl = Array.isArray(lsp4.icon) && lsp4.icon[0] && typeof lsp4.icon[0] === "object" ? lsp4.icon[0].url : null;
  return {
    name: cleanText(lsp4.name),
    attributes,
    icon: isSafeIpfsUri(iconUrl) ? iconUrl : null
  };
}
