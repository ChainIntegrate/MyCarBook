#!/usr/bin/env node
"use strict";
// Controlla che TUTTI i file referenziati dal contratto siano pinnati sul
// nodo IPFS proprio (audit MCB-17). Da eseguire sul VPS (serve l'API Kubo).
//
//   node scripts/check-pins.js                  solo controllo
//   node scripts/check-pins.js --repin          ripinna i mancanti (rete IPFS, poi CAR dai gateway)
//   node scripts/check-pins.js --gc-orphans     elenca i pin orfani (caricati ma mai usati sul contratto)
//   node scripts/check-pins.js --gc-orphans --apply   ...e li rimuove (solo se più vecchi di 48 h)
//
// Uscita: 0 tutto pinnato, 1 file mancanti, 2 errore.
const { setup } = require("./common");
const { checkPins, repinOne, gcOrphans, readLedger } = require("../lib/pin-ops");
const { loadConfig } = require("../lib/config");

async function main() {
  const args = new Set(process.argv.slice(2));
  const verbose = args.has("--verbose");
  const { kubo, gateways, collect } = setup();
  const { cids, unreadable } = await collect(verbose ? console.log : () => {});
  console.log(`CID referenziati dal contratto: ${cids.size}${unreadable.length ? ` (metadata non leggibili: ${unreadable.length})` : ""}`);

  let { missing } = await checkPins({ cids, kubo });
  for (const cid of missing) console.log(`MANCANTE ${cid}  (${cids.get(cid)})`);

  if (args.has("--repin") && missing.length) {
    const still = [];
    for (const cid of missing) {
      const r = await repinOne({ cid, kubo, gateways, log: console.log });
      console.log(r.ok ? `RIPINNATO ${cid} via ${r.via}` : `NON RIPINNATO ${cid}`);
      if (!r.ok) still.push(cid);
    }
    missing = still;
  }

  if (args.has("--gc-orphans")) {
    const ledger = readLedger(loadConfig().pinLedgerPath);
    const gc = await gcOrphans({ ledger, referenced: cids, unreadable, kubo, apply: args.has("--apply") });
    if (gc.aborted) console.log(`PULIZIA SALTATA: ${gc.aborted}`);
    else {
      for (const cid of gc.candidates) console.log(`${args.has("--apply") ? "RIMOSSO" : "ORFANO"} ${cid}`);
      console.log(`Pin orfani: ${gc.candidates.length}${args.has("--apply") ? `, rimossi: ${gc.removed.length}` : " (usa --apply per rimuoverli)"}`);
    }
  }

  console.log(missing.length ? `ESITO: ${missing.length} file NON presenti sul nodo` : "ESITO: tutti i file sono pinnati sul nodo");
  process.exitCode = missing.length ? 1 : 0;
}

main().catch((err) => {
  console.error("Errore:", err.message);
  process.exitCode = 2;
});
