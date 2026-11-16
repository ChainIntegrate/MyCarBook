"use strict";
// Raccolta di tutti i CID IPFS referenziati dal contratto MyCarBookV2
// (audit MCB-17): metadata di collezione, metadata di ogni veicolo (anche
// le versioni precedenti, sostituite con setDataForTokenId), foto citate
// nei metadata, documenti allegati agli interventi ([doc:ipfs://CID]).

const { ethers } = require("ethers");

const LSP4_METADATA_KEY = "0x9afb95cacc9f95858ec44aa8c3b685511002e30ae54415823f406128b85b238e";
const ABI = [
  "event DataChanged(bytes32 indexed dataKey, bytes dataValue)",
  "event TokenIdDataChanged(bytes32 indexed tokenId, bytes32 indexed dataKey, bytes dataValue)",
  "event InterventionLogged(bytes32 indexed tokenId, address indexed loggedBy, uint256 date, uint256 km, uint8 categoryFlags, uint256 amountCents, string description)",
  "function getData(bytes32 dataKey) view returns (bytes)"
];
const iface = new ethers.Interface(ABI);
const CID_RE = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,100})$/;
const DOC_RE = /\[doc:ipfs:\/\/([A-Za-z0-9]+)\]\s*$/;

function cidFromIpfsUrl(url) {
  if (typeof url !== "string" || !url.startsWith("ipfs://")) return null;
  const cid = url.slice(7).split("/")[0];
  return CID_RE.test(cid) ? cid : null;
}

// VerifiableURI (LSP2): 0x0000 + metodo(4) + lunghezza(2) + hash + URL.
function urlFromVerifiableUri(value) {
  const bytes = ethers.getBytes(value);
  if (bytes.length < 8) return null;
  if (bytes[0] === 0 && bytes[1] === 0) {
    const len = (bytes[6] << 8) | bytes[7];
    return ethers.toUtf8String(bytes.slice(8 + len));
  }
  // vecchio formato JSONURL: hashFunction(4) + hash(32) + URL
  return bytes.length > 36 ? ethers.toUtf8String(bytes.slice(36)) : null;
}

function cidsFromMetadataJson(json) {
  const out = new Set();
  const m = json && json.LSP4Metadata;
  if (!m || typeof m !== "object") return out;
  const images = [].concat(Array.isArray(m.icon) ? m.icon : [], ...(Array.isArray(m.images) ? m.images : []).map((r) => (Array.isArray(r) ? r : [])),
    Array.isArray(m.assets) ? m.assets : []);
  for (const img of images) {
    const cid = img && cidFromIpfsUrl(img.url);
    if (cid) out.add(cid);
  }
  return out;
}

/**
 * @param {object} deps
 * @param {(filter)=>Promise<Array>} deps.getLogs   eth_getLogs (address, fromBlock, toBlock)
 * @param {()=>Promise<number>} deps.getBlockNumber
 * @param {(cid)=>Promise<object>} deps.fetchJson   legge un JSON da IPFS (nodo proprio, poi gateway)
 * @returns {Promise<{cids: Map<string,string>, unreadable: string[]}>} cid -> descrizione
 */
async function collectReferencedCids({ contractAddress, fromBlock, getLogs, getBlockNumber, fetchJson, getData, windowSize = 9000, log = () => {} }) {
  const cids = new Map();
  const metadataCids = new Set();
  const unreadable = [];
  const add = (cid, what) => { if (cid && !cids.has(cid)) cids.set(cid, what); };

  const latest = await getBlockNumber();
  for (let start = fromBlock; start <= latest; start += windowSize) {
    const end = Math.min(start + windowSize - 1, latest);
    const logs = await getLogs({ address: contractAddress, fromBlock: start, toBlock: end });
    for (const l of logs) {
      let parsed;
      try { parsed = iface.parseLog(l); } catch { continue; }
      if (!parsed) continue;
      if (parsed.name === "InterventionLogged") {
        const m = DOC_RE.exec(parsed.args.description);
        if (m && CID_RE.test(m[1])) add(m[1], `documento intervento token ${parsed.args.tokenId}`);
      } else if (parsed.args.dataKey === LSP4_METADATA_KEY) {
        const cid = cidFromIpfsUrl(urlFromVerifiableUri(parsed.args.dataValue));
        if (cid) {
          metadataCids.add(cid);
          add(cid, parsed.name === "DataChanged" ? "metadata collezione" : `metadata token ${parsed.args.tokenId}`);
        }
      }
    }
    log(`blocchi ${start}-${end}: ${logs.length} eventi`);
  }

  if (getData) {
    const current = await getData(LSP4_METADATA_KEY);
    const cid = current && current !== "0x" ? cidFromIpfsUrl(urlFromVerifiableUri(current)) : null;
    if (cid) { metadataCids.add(cid); add(cid, "metadata collezione"); }
  }

  for (const cid of metadataCids) {
    try {
      const json = await fetchJson(cid);
      for (const img of cidsFromMetadataJson(json)) add(img, `immagine citata in ${cid}`);
    } catch (err) {
      unreadable.push(cid);
      log(`metadata ${cid} non leggibile: ${err.message}`);
    }
  }
  return { cids, unreadable };
}

module.exports = { collectReferencedCids, urlFromVerifiableUri, cidFromIpfsUrl, cidsFromMetadataJson, LSP4_METADATA_KEY, iface };
