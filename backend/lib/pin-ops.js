"use strict";
// Controllo, ripristino, pulizia e backup dei pin sul nodo IPFS proprio
// (audit MCB-17, MCB-03, MCB-06). Logica separata dagli script per i test.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

async function checkPins({ cids, kubo }) {
  const missing = [];
  for (const cid of cids.keys()) {
    if (!(await kubo.isPinned(cid))) missing.push(cid);
  }
  return { total: cids.size, missing };
}

/**
 * Ripinna un CID mancante: prima dalla rete IPFS (pin/add), poi scaricando
 * un CAR da un gateway di riserva e importandolo (Kubo verifica ogni
 * blocco contro il suo hash). Un CAR con radice diversa viene scartato.
 */
async function repinOne({ cid, kubo, gateways, fetchImpl = fetch, pinAddTimeoutMs = 60000, log = () => {} }) {
  try {
    if (await kubo.pinAdd(cid, pinAddTimeoutMs)) return { cid, ok: true, via: "rete IPFS" };
  } catch (err) {
    log(`${cid}: pin/add non riuscito (${err.message}), provo i gateway`);
  }
  for (const gw of gateways) {
    try {
      const res = await fetchImpl(`${gw.replace(/\/$/, "")}/ipfs/${cid}?format=car`, {
        headers: { Accept: "application/vnd.ipld.car" },
        signal: AbortSignal.timeout(300000)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const car = Buffer.from(await res.arrayBuffer());
      const roots = await kubo.dagImport(car);
      if (!roots.includes(cid)) {
        for (const r of roots) {
          try { await kubo.pinRm(r); } catch { /* già assente */ }
        }
        throw new Error(`il CAR ha radice ${roots.join(",") || "nessuna"}, atteso ${cid}`);
      }
      if (await kubo.isPinned(cid)) return { cid, ok: true, via: gw };
      throw new Error("import riuscito ma pin assente");
    } catch (err) {
      log(`${cid}: ${gw} non utilizzabile (${err.message})`);
    }
  }
  return { cid, ok: false };
}

function readLedger(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter((e) => e && typeof e.cid === "string" && e.at);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

/**
 * Pin "orfani": caricati dal backend per un mint/intervento poi annullato
 * (CID mai comparso sul contratto). Rimossi solo se più vecchi di minAgeMs
 * e solo se l'elenco dei CID referenziati è completo.
 */
async function gcOrphans({ ledger, referenced, unreadable, kubo, now = Date.now(), minAgeMs = 48 * 3600 * 1000, apply = false }) {
  if (unreadable.length > 0) {
    return { aborted: `metadata non leggibili (${unreadable.join(", ")}): elenco dei CID referenziati incompleto, nessuna rimozione`, removed: [], candidates: [] };
  }
  const youngest = new Map();
  for (const e of ledger) {
    const t = Date.parse(e.at);
    if (!youngest.has(e.cid) || t > youngest.get(e.cid)) youngest.set(e.cid, t);
  }
  const candidates = [...youngest].filter(([cid, t]) => !referenced.has(cid) && now - t > minAgeMs).map(([cid]) => cid);
  const removed = [];
  if (apply) {
    for (const cid of candidates) {
      await kubo.pinRm(cid);
      removed.push(cid);
    }
  }
  return { aborted: null, candidates, removed };
}

async function backupCars({ cids, kubo, outDir }) {
  fs.mkdirSync(outDir, { recursive: true });
  const manifest = [];
  const failed = [];
  for (const [cid, what] of cids) {
    try {
      const car = await kubo.dagExport(cid);
      const file = `${cid}.car`;
      fs.writeFileSync(path.join(outDir, file), car);
      manifest.push({ cid, what, file, bytes: car.length, sha256: crypto.createHash("sha256").update(car).digest("hex") });
    } catch (err) {
      failed.push({ cid, error: err.message });
    }
  }
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify({ createdAt: new Date().toISOString(), items: manifest, failed }, null, 2));
  return { saved: manifest.length, failed };
}

module.exports = { checkPins, repinOne, gcOrphans, backupCars, readLedger };
