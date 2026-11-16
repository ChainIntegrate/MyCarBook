"use strict";
// Punto 3: le azioni admin devono essere firmate da UNA chiave precisa
// (ADMIN_SIGNER_ADDRESS), non da un controller qualsiasi della UP owner.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startApp, signAuth, wallets, UP, postJson, postFile, png } = require("./helpers");

let ctx;
before(async () => { ctx = await startApp(); });
after(async () => ctx.close());

const collectionJson = JSON.stringify({ LSP4Metadata: { name: "MyCarBook", description: "x", links: [], icon: [], images: [], assets: [], attributes: [] } });

test("un altro controller della UP owner NON può fare upload admin (prima bastava)", async () => {
  const img = png();
  const h = await signAuth({ wallet: wallets.ownerOtherKey, up: UP.owner, purpose: "admin", content: img });
  const res = await postFile(ctx.base, img, h);
  assert.equal(res.status, 403);

  const h2 = await signAuth({ wallet: wallets.ownerOtherKey, up: UP.owner, purpose: "admin", content: Buffer.from(collectionJson) });
  const res2 = await postJson(ctx.base, collectionJson, h2);
  assert.equal(res2.status, 403);
  assert.equal(ctx.ipfs.pinned.length, 0);
});

test("la chiave admin non vale per una UP diversa da quella configurata", async () => {
  const img = png();
  const h = await signAuth({ wallet: wallets.adminKey, up: UP.user, purpose: "admin", content: img });
  const res = await postFile(ctx.base, img, h);
  assert.equal(res.status, 403);
});

test("la chiave admin tolta dai controller della UP non vale più", async () => {
  const local = await startApp();
  try {
    local.chain.addUp(UP.owner, [wallets.ownerOtherKey.address]); // chiave admin rimossa
    const img = png();
    const h = await signAuth({ wallet: wallets.adminKey, up: UP.owner, purpose: "admin", content: img });
    const res = await postFile(local.base, img, h);
    assert.equal(res.status, 401);
  } finally {
    await local.close();
  }
});

test("senza ADMIN_SIGNER_ADDRESS le azioni admin sono disattivate", async () => {
  const local = await startApp({ env: { ADMIN_SIGNER_ADDRESS: "" } });
  try {
    const img = png();
    const h = await signAuth({ wallet: wallets.adminKey, up: UP.owner, purpose: "admin", content: img });
    const res = await postFile(local.base, img, h);
    assert.equal(res.status, 403);
  } finally {
    await local.close();
  }
});

test("la chiave admin configurata può fare upload admin", async () => {
  const img = png();
  const h = await signAuth({ wallet: wallets.adminKey, up: UP.owner, purpose: "admin", content: img });
  const res = await postFile(ctx.base, img, h);
  assert.equal(res.status, 200);

  const h2 = await signAuth({ wallet: wallets.adminKey, up: UP.owner, purpose: "admin", content: Buffer.from(collectionJson) });
  const res2 = await postJson(ctx.base, collectionJson, h2);
  assert.equal(res2.status, 200);
});

// ADMIN_SIGNER_ADDRESS=any: qualunque controller della UP owner con SIGN
// (comportamento richiesto dopo il rilascio), ma solo per la UP owner.
test("modalità any: un altro controller della UP owner è accettato", async () => {
  const local = await startApp({ env: { ADMIN_SIGNER_ADDRESS: "any" } });
  try {
    const img = png();
    const h = await signAuth({ wallet: wallets.ownerOtherKey, up: UP.owner, purpose: "admin", content: img });
    assert.equal((await postFile(local.base, img, h)).status, 200);
  } finally {
    await local.close();
  }
});

test("modalità any: una UP diversa dalla owner resta rifiutata", async () => {
  const local = await startApp({ env: { ADMIN_SIGNER_ADDRESS: "ANY" } });
  try {
    const img = png();
    const h = await signAuth({ wallet: wallets.userCtrl, up: UP.user, purpose: "admin", content: img });
    assert.equal((await postFile(local.base, img, h)).status, 403);
    assert.equal(local.ipfs.pinned.length, 0);
  } finally {
    await local.close();
  }
});

test("modalità any: chi non è controller della UP owner resta rifiutato", async () => {
  const local = await startApp({ env: { ADMIN_SIGNER_ADDRESS: "any" } });
  try {
    const img = png();
    const h = await signAuth({ wallet: wallets.userCtrl, up: UP.owner, purpose: "admin", content: img });
    assert.equal((await postFile(local.base, img, h)).status, 401);

    const json = JSON.stringify({ LSP4Metadata: { name: "x" } });
    const h2 = await signAuth({ wallet: wallets.otherCtrl, up: UP.owner, purpose: "admin", content: Buffer.from(json) });
    assert.equal((await postJson(local.base, json, h2)).status, 401);
    assert.equal(local.ipfs.pinned.length, 0);
  } finally {
    await local.close();
  }
});

test("modalità any: senza ADMIN_UP_ADDRESS le azioni admin restano disattivate", async () => {
  const local = await startApp({ env: { ADMIN_SIGNER_ADDRESS: "any", ADMIN_UP_ADDRESS: "" } });
  try {
    const img = png();
    const h = await signAuth({ wallet: wallets.adminKey, up: UP.owner, purpose: "admin", content: img });
    assert.equal((await postFile(local.base, img, h)).status, 403);
  } finally {
    await local.close();
  }
});

test("valore non valido in ADMIN_SIGNER_ADDRESS: il server non parte", () => {
  const { loadConfig } = require("../lib/config");
  assert.throws(() => loadConfig({ ADMIN_SIGNER_ADDRESS: "tutti" }), /ADMIN_SIGNER_ADDRESS/);
});
