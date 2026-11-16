// Link IPFS: si accettano solo "ipfs://<CID>" (con eventuale percorso
// semplice). Tutto il resto (virgolette, spazi, "javascript:", ecc.) viene
// scartato prima di arrivare in un attributo src/href (audit MCB-01).

const CID_V0 = "Qm[1-9A-HJ-NP-Za-km-z]{44}";
const CID_V1 = "b[a-z2-7]{58,100}";
const SEGMENT = "/(?!\\.{1,2}(?:/|$))[A-Za-z0-9._-]+"; // niente "." o ".."
const IPFS_URI_RE = new RegExp(`^ipfs://(${CID_V0}|${CID_V1})((?:${SEGMENT})*)$`);

export const GATEWAYS = [
  "https://ipfs.chainintegrate.it/ipfs/",
  // rete di sicurezza per i file non ancora presenti sul nodo proprio (MCB-17)
  "https://api.universalprofile.cloud/ipfs/"
];

export function parseIpfsUri(uri) {
  if (typeof uri !== "string") return null;
  const m = IPFS_URI_RE.exec(uri);
  if (!m) return null;
  return { cid: m[1], path: m[2] || "" };
}

export function isSafeIpfsUri(uri) {
  return parseIpfsUri(uri) !== null;
}

/** URL dei gateway, nell'ordine in cui provarli; [] se il link non è valido. */
export function gatewayUrls(uri) {
  const parsed = parseIpfsUri(uri);
  if (!parsed) return [];
  return GATEWAYS.map((g) => `${g}${parsed.cid}${parsed.path}`);
}

// Il documento allegato a un intervento è agganciato in coda alla
// descrizione: "testo [doc:ipfs://CID]". Un marcatore non valido NON
// diventa un link: resta testo normale.
const DOC_MARKER_RE = /\s*\[doc:([^\]]*)\]\s*$/;

export function parseDocMarker(description) {
  const text = typeof description === "string" ? description : "";
  const m = DOC_MARKER_RE.exec(text);
  if (!m || !isSafeIpfsUri(m[1])) return { text, docUri: null };
  return { text: text.slice(0, m.index), docUri: m[1] };
}
