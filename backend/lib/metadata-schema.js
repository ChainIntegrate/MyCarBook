"use strict";
// Schema rigido del JSON LSP4Metadata accettato da /api/pin-json per il
// mint di un veicolo (audit MCB-03, MCB-01): solo i campi che l'app scrive,
// con limiti di lunghezza, e link IPFS in forma ristretta. Qualunque altra
// chiave o forma viene rifiutata.

const IPFS_URI_RE = /^ipfs:\/\/[A-Za-z0-9]{46,100}$/;
const ATTRIBUTE_KEYS = ["Brand", "Model", "Trim", "Plate", "VIN"];
const LIMITS = { name: 100, attributeValue: 64, description: 200 };

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

function onlyKeys(obj, keys) {
  return Object.keys(obj).every((k) => keys.includes(k));
}

function isSafeString(s, max) {
  // niente caratteri di controllo (inclusi a capo) nei campi brevi
  return typeof s === "string" && s.length <= max && !/[\u0000-\u001f\u007f]/.test(s);
}

function validImage(img) {
  return isPlainObject(img)
    && onlyKeys(img, ["width", "height", "url", "verification"])
    && Number.isInteger(img.width) && img.width > 0 && img.width <= 10000
    && Number.isInteger(img.height) && img.height > 0 && img.height <= 10000
    && typeof img.url === "string" && IPFS_URI_RE.test(img.url)
    && isPlainObject(img.verification)
    && onlyKeys(img.verification, ["method", "data"])
    && img.verification.method === "keccak256(bytes)"
    && typeof img.verification.data === "string" && /^0x[0-9a-fA-F]{64}$/.test(img.verification.data);
}

/** @returns {string|null} messaggio d'errore, oppure null se valido */
function validateVehicleMetadata(json) {
  if (!isPlainObject(json) || !onlyKeys(json, ["LSP4Metadata"]) || !isPlainObject(json.LSP4Metadata)) {
    return "atteso un oggetto con la sola chiave LSP4Metadata";
  }
  const m = json.LSP4Metadata;
  if (!onlyKeys(m, ["name", "description", "links", "icon", "images", "assets", "attributes"])) return "campi non ammessi";
  if (!isSafeString(m.name, LIMITS.name) || m.name.trim() === "") return "name non valido";
  if (!isSafeString(m.description, LIMITS.description)) return "description non valida";
  if (!Array.isArray(m.links) || m.links.length !== 0) return "links non ammessi";
  if (!Array.isArray(m.assets) || m.assets.length !== 0) return "assets non ammessi";
  if (!Array.isArray(m.icon) || m.icon.length > 1 || !m.icon.every(validImage)) return "icon non valida";
  if (!Array.isArray(m.images) || m.images.length > 1
    || !m.images.every((row) => Array.isArray(row) && row.length === 1 && validImage(row[0]))) return "images non valide";
  if (!Array.isArray(m.attributes) || m.attributes.length > ATTRIBUTE_KEYS.length) return "attributes non valide";
  const seen = new Set();
  for (const a of m.attributes) {
    if (!isPlainObject(a) || !onlyKeys(a, ["key", "value", "type"])) return "attribute non valida";
    if (!ATTRIBUTE_KEYS.includes(a.key) || seen.has(a.key)) return "attribute non ammessa";
    seen.add(a.key);
    if (a.type !== "string" || !isSafeString(a.value, LIMITS.attributeValue) || a.value.trim() === "") return "valore attribute non valido";
  }
  return null;
}

// Pannello admin: JSON di collezione o merge sul veicolo. Chiave admin già
// verificata; controllo solo la forma generale e i link immagine.
function validateAdminMetadata(json) {
  if (!isPlainObject(json) || !onlyKeys(json, ["LSP4Metadata"]) || !isPlainObject(json.LSP4Metadata)) {
    return "atteso un oggetto con la sola chiave LSP4Metadata";
  }
  const m = json.LSP4Metadata;
  for (const field of ["icon"]) {
    if (m[field] !== undefined && (!Array.isArray(m[field]) || !m[field].every(validImage))) return `${field} non valida`;
  }
  if (m.images !== undefined && (!Array.isArray(m.images) || !m.images.every((r) => Array.isArray(r) && r.every(validImage)))) {
    return "images non valide";
  }
  return null;
}

module.exports = { validateVehicleMetadata, validateAdminMetadata, IPFS_URI_RE, ATTRIBUTE_KEYS, LIMITS };
