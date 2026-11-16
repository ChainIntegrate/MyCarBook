// Firma upload (MCB-09), km (MCB-12), cache storico (MCB-14), lista
// nascosti e trasferimento (MCB-11).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { ethers } from "ethers";
import { buildAuthMessage, signUploadHeaders } from "../../frontend/js/lib/auth-message.js";
import { validateKm, kmJumpCheck, needsIdentityAck, validateTransferTarget, validateAttributeLengths } from "../../frontend/js/lib/validation.js";
import { createLogCache } from "../../frontend/js/lib/log-cache.js";
import { createHiddenList } from "../../frontend/js/lib/hidden.js";

const require = createRequire(import.meta.url);
const backendAuth = require("../../backend/lib/auth.js");

test("messaggio firmato identico tra frontend e backend", () => {
  const p = { domain: "mycarbook.chainintegrate.it", purpose: "photo", address: "0xAbC0000000000000000000000000000000000001", chainId: 42, sha256: "AB".repeat(32), nonce: "0".repeat(32), issuedAt: 1700000000000 };
  assert.equal(buildAuthMessage(p), backendAuth.buildAuthMessage(p));
});

test("le intestazioni firmate dal frontend legano contenuto e nonce", async () => {
  const wallet = ethers.Wallet.createRandom();
  const bytes = new TextEncoder().encode("ciao");
  const h1 = await signUploadHeaders({ signer: wallet, address: wallet.address, chainId: 42, purpose: "metadata", bytes, now: 1 });
  const h2 = await signUploadHeaders({ signer: wallet, address: wallet.address, chainId: 42, purpose: "metadata", bytes, now: 1 });
  assert.equal(h1["X-MCB-Content-SHA256"], "b133a0c0e9bee3be20163d2ad31d6248db292aa6dcb1ee087a2aa50e0fc75ae2");
  assert.notEqual(h1["X-MCB-Nonce"], h2["X-MCB-Nonce"]);
  const msg = buildAuthMessage({ domain: "mycarbook.chainintegrate.it", purpose: "metadata", address: wallet.address, chainId: 42, sha256: h1["X-MCB-Content-SHA256"], nonce: h1["X-MCB-Nonce"], issuedAt: 1 });
  assert.equal(ethers.verifyMessage(msg, h1["X-MCB-Signature"]), wallet.address);
});

test("km: rifiutati valori non interi, negativi o fuori scala", () => {
  for (const bad of ["", "-1", "1e9", "12.5", "abc", "2000001", "99999999999999999999"]) assert.notEqual(validateKm(bad), null, bad);
  for (const ok of ["0", "150000", "2000000"]) assert.equal(validateKm(ok), null, ok);
  assert.equal(kmJumpCheck(1_000_000, 100_000), "confirm");
  assert.equal(kmJumpCheck(120_000, 100_000), "ok");
  assert.equal(kmJumpCheck(50_000, 100_000), "ok", "voce retroattiva");
});

test("presa d'atto richiesta solo con targa o VIN", () => {
  assert.equal(needsIdentityAck({ plate: "", vin: "  " }), false);
  assert.equal(needsIdentityAck({ plate: "AB123CD", vin: "" }), true);
  assert.equal(needsIdentityAck({ plate: "", vin: "ZFA" }), true);
  assert.equal(validateAttributeLengths({ name: "x".repeat(101) }), "toastFieldTooLong");
  assert.equal(validateAttributeLengths({ name: "x", vin: "V".repeat(65) }), "toastFieldTooLong");
});

test("trasferimento: indirizzo non valido, proprio, del contratto o zero rifiutati", () => {
  const from = ethers.Wallet.createRandom().address;
  const contract = ethers.Wallet.createRandom().address;
  const base = { from, contractAddress: contract, isAddress: ethers.isAddress };
  assert.equal(validateTransferTarget({ ...base, to: "0x123" }), "toastTransferInvalidAddress");
  assert.equal(validateTransferTarget({ ...base, to: from.toLowerCase() }), "toastTransferSelf");
  assert.equal(validateTransferTarget({ ...base, to: contract }), "toastTransferInvalidAddress");
  assert.equal(validateTransferTarget({ ...base, to: ethers.ZeroAddress }), "toastTransferInvalidAddress");
  assert.equal(validateTransferTarget({ ...base, to: ethers.Wallet.createRandom().address }), null);
});

test("storico: prima lettura dal deploy, poi solo blocchi nuovi; ridisegno senza letture", async () => {
  let head = 8_072_041 + 20_000;
  const ranges = [];
  const cache = createLogCache({
    getBlockNumber: async () => head,
    queryRange: async (id, from, to) => { ranges.push([from, to]); return [{ id, from }]; },
    startBlock: 8_072_041,
    sleep: async () => {}
  });
  await cache.refresh("0x01");
  assert.equal(ranges.length, 3, "20.001 blocchi in finestre da 9.000");
  assert.ok(ranges.every(([a, b]) => b - a < 9000));
  const n = ranges.length;
  assert.ok(cache.cached("0x01").length === 3);
  assert.equal(ranges.length, n, "cached() non legge la catena");
  await cache.refresh("0x01");
  assert.equal(ranges.length, n, "nessun blocco nuovo => nessuna richiesta");
  head += 10;
  await cache.refresh("0x01");
  assert.deepEqual(ranges.at(-1), [head - 9, head]);
});

test("storico: errori temporanei ritentati, errori persistenti segnalati", async () => {
  let calls = 0;
  const cache = createLogCache({
    getBlockNumber: async () => 100,
    queryRange: async () => { calls++; throw new Error("rpc down"); },
    startBlock: 0,
    sleep: async () => {}
  });
  await assert.rejects(cache.refresh("0x01"), /rpc down/);
  assert.equal(calls, 3);
});

test("lista nascosti: per indirizzo, robusta a storage rotto", () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const a = createHiddenList(storage, "0xAAA");
  a.hide("0x01");
  assert.equal(createHiddenList(storage, "0xaaa").has("0x01"), true);
  assert.equal(createHiddenList(storage, "0xBBB").has("0x01"), false);
  mem.set("mcb_hidden_tokens", "{rotto");
  assert.equal(createHiddenList(storage, "0xAAA").count(), 0);
  const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  const h = createHiddenList(throwing, "0xA");
  h.hide("0x02");
  assert.equal(h.has("0x02"), true);
});
