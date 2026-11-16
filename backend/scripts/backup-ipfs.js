#!/usr/bin/env node
"use strict";
// Esporta in file CAR tutti i contenuti referenziati dal contratto, con
// manifest (CID, dimensione, SHA-256). Il CAR contiene i blocchi originali:
// reimportandolo (ipfs dag import) si ottiene lo stesso CID.
//   node scripts/backup-ipfs.js --out /var/backups/mycarbook-ipfs/2026-11-16
const { setup } = require("./common");
const { backupCars } = require("../lib/pin-ops");

async function main() {
  const i = process.argv.indexOf("--out");
  if (i < 0 || !process.argv[i + 1]) throw new Error("uso: backup-ipfs.js --out <cartella>");
  const { kubo, collect } = setup();
  const { cids, unreadable } = await collect(() => {});
  const r = await backupCars({ cids, kubo, outDir: process.argv[i + 1] });
  console.log(`Salvati ${r.saved}/${cids.size} CAR in ${process.argv[i + 1]}`);
  for (const f of r.failed) console.log(`NON SALVATO ${f.cid}: ${f.error}`);
  if (unreadable.length) console.log(`Metadata non leggibili: ${unreadable.join(", ")}`);
  process.exitCode = r.failed.length || unreadable.length ? 1 : 0;
}

main().catch((err) => {
  console.error("Errore:", err.message);
  process.exitCode = 2;
});
