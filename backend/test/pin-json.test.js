"use strict";
// MCB-03: /api/pin-json non autenticato. Ogni test prova un modo di
// aggirare l'autorizzazione e verifica che NULLA venga pinnato.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startApp, signAuth, wallets, UP, vehicleMetadata, postJson } = require("./helpers");

let ctx;
before(async () => { ctx = await startApp(); });
after(async () => ctx.close());

const body = () => JSON.stringify(vehicleMetadata());

test("rifiuta una richiesta senza firma (comportamento precedente: pin per chiunque)", async () => {
  const before = ctx.ipfs.pinned.length;
  const res = await postJson(ctx.base, body());
  assert.equal(res.status, 401);
  assert.equal(ctx.ipfs.pinned.length, before);
});

test("rifiuta una firma di un controller che non appartiene alla UP dichiarata", async () => {
  const b = body();
  const headers = await signAuth({ wallet: wallets.otherCtrl, up: UP.user, purpose: "metadata", content: Buffer.from(b) });
  const res = await postJson(ctx.base, b, headers);
  assert.equal(res.status, 401);
});

test("rifiuta un contenuto diverso da quello firmato", async () => {
  const signed = body();
  const headers = await signAuth({ wallet: wallets.userCtrl, up: UP.user, purpose: "metadata", content: Buffer.from(signed) });
  const tampered = JSON.stringify(vehicleMetadata({ name: "Altro" }));
  const res = await postJson(ctx.base, tampered, headers);
  assert.equal(res.status, 400);
});

test("una firma vale una sola volta (replay rifiutato)", async () => {
  const b = body();
  const headers = await signAuth({ wallet: wallets.userCtrl, up: UP.user, purpose: "metadata", content: Buffer.from(b) });
  const first = await postJson(ctx.base, b, headers);
  assert.equal(first.status, 200);
  const second = await postJson(ctx.base, b, headers);
  assert.equal(second.status, 401);
});

test("rifiuta firme per un altro dominio, per testnet, scadute o dal futuro", async () => {
  const b = Buffer.from(body());
  const cases = [
    await signAuth({ wallet: wallets.userCtrl, up: UP.user, purpose: "metadata", content: b, domain: "evil.example" }),
    await signAuth({ wallet: wallets.userCtrl, up: UP.user, purpose: "metadata", content: b, chainId: 4201 }),
    await signAuth({ wallet: wallets.userCtrl, up: UP.user, purpose: "metadata", content: b, issuedAt: Date.now() - 6 * 60 * 1000 }),
    await signAuth({ wallet: wallets.userCtrl, up: UP.user, purpose: "metadata", content: b, issuedAt: Date.now() + 5 * 60 * 1000 })
  ];
  for (const h of cases) {
    const res = await postJson(ctx.base, b.toString(), h);
    assert.ok([400, 401].includes(res.status), `atteso rifiuto, ricevuto ${res.status}`);
  }
});

test("tollera un orologio del client leggermente avanti (30 s)", async () => {
  const b = Buffer.from(body());
  const h = await signAuth({ wallet: wallets.userCtrl, up: UP.user, purpose: "metadata", content: b, issuedAt: Date.now() + 30 * 1000 });
  const res = await postJson(ctx.base, b.toString(), h);
  assert.equal(res.status, 200);
});

test("schema rigido: rifiuta chiavi extra, link immagine con payload XSS, testi lunghi", async () => {
  const bad = [
    { ...vehicleMetadata(), extra: "x".repeat(1000) },
    vehicleMetadata({ hostedContent: "free hosting" }),
    vehicleMetadata({ icon: [{ width: 1, height: 1, url: 'ipfs://x" onerror="alert(document.domain)" a="', verification: { method: "keccak256(bytes)", data: "0x" + "0".repeat(64) } }] }),
    vehicleMetadata({ name: "x".repeat(101) }),
    vehicleMetadata({ attributes: [{ key: "Owner", value: "Mario Rossi", type: "string" }] }),
    vehicleMetadata({ attributes: [{ key: "VIN", value: "A".repeat(65), type: "string" }] })
  ];
  for (const json of bad) {
    const b = JSON.stringify(json);
    const h = await signAuth({ wallet: wallets.userCtrl, up: UP.user, purpose: "metadata", content: Buffer.from(b) });
    const res = await postJson(ctx.base, b, h);
    assert.equal(res.status, 400, b.slice(0, 80));
  }
});

test("pinna i byte esattamente come firmati", async () => {
  const b = body();
  const h = await signAuth({ wallet: wallets.userCtrl, up: UP.user, purpose: "metadata", content: Buffer.from(b) });
  const res = await postJson(ctx.base, b, h);
  assert.equal(res.status, 200);
  assert.equal(ctx.ipfs.pinned.at(-1).buffer.toString(), b);
  assert.equal(ctx.ledgerEntries.at(-1).purpose, "metadata");
  assert.equal(JSON.stringify(ctx.ledgerEntries.at(-1)).includes(UP.user), false, "il registro pin non salva indirizzi");
});

test("purpose diversi da metadata/admin non sono accettati su pin-json", async () => {
  const b = body();
  const h = await signAuth({ wallet: wallets.userCtrl, up: UP.user, purpose: "photo", content: Buffer.from(b) });
  const res = await postJson(ctx.base, b, h);
  assert.equal(res.status, 400);
});

test("il rate limit resta attivo", async () => {
  const limited = await startApp({ limits: { json: 2 } });
  try {
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await postJson(limited.base, body())).status);
    assert.deepEqual(statuses, [401, 401, 429]);
  } finally {
    await limited.close();
  }
});
