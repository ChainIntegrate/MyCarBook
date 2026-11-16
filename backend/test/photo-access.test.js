"use strict";
// MCB-09: la lista manuale non è più interrogabile per un indirizzo
// qualsiasi; serve la firma della UP stessa.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const { startApp, signAuth, wallets, UP } = require("./helpers");

let ctx;
before(async () => {
  ctx = await startApp();
  fs.writeFileSync(ctx.config.allowedAddressesPath, JSON.stringify([UP.user]));
});
after(async () => ctx.close());

test("la vecchia GET pubblica non esiste più", async () => {
  const res = await fetch(`${ctx.base}/api/photo-access/${UP.user}`);
  assert.equal(res.status, 404);
});

test("POST senza firma: 401", async () => {
  const res = await fetch(`${ctx.base}/api/photo-access`, { method: "POST" });
  assert.equal(res.status, 401);
});

test("non si può chiedere per la UP di un altro", async () => {
  const h = await signAuth({ wallet: wallets.otherCtrl, up: UP.user, purpose: "access" });
  const res = await fetch(`${ctx.base}/api/photo-access`, { method: "POST", headers: h });
  assert.equal(res.status, 401);
});

test("la UP stessa, firmando, riceve la risposta", async () => {
  const h = await signAuth({ wallet: wallets.userCtrl, up: UP.user, purpose: "access" });
  const res = await fetch(`${ctx.base}/api/photo-access`, { method: "POST", headers: h });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { allowed: true });
});
