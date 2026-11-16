"use strict";
// MCB-09 (firma legata al file, monouso, solo mainnet), MCB-10 (tipo reale
// del file), MCB-06 (metadati EXIF), MCB-07 (richieste malformate).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const { startApp, signAuth, wallets, UP, postFile, jpeg, png } = require("./helpers");

let ctx;
before(async () => {
  ctx = await startApp({ limits: { file: 1000 } });
  ctx.chain.setTier(UP.user, 1); // Bronze
});
after(async () => ctx.close());

test("senza firma: 401 e il file non viene nemmeno letto", async () => {
  const res = await postFile(ctx.base, jpeg());
  assert.equal(res.status, 401);
  assert.equal(ctx.ipfs.pinned.length, 0);
});

test("multipart malformato senza firma: 401, nessun crash", async () => {
  const res = await fetch(`${ctx.base}/api/pin-file`, {
    method: "POST",
    headers: { "Content-Type": "multipart/form-data; boundary=x" },
    body: "--x\r\nContent-Disposition: form-data; name=\"file\"\r\n\r\n"
  });
  assert.equal(res.status, 401);
  assert.equal((await fetch(`${ctx.base}/api/health`)).status, 200);
});

test("multipart malformato CON firma valida: 4xx, il processo resta su", async () => {
  const img = jpeg();
  const h = await signAuth({ wallet: wallets.userCtrl, up: UP.user, purpose: "photo", content: img });
  const res = await fetch(`${ctx.base}/api/pin-file`, {
    method: "POST",
    headers: { ...h, "Content-Type": "multipart/form-data; boundary=x" },
    body: "--x\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a\"\r\n\r\nabc"
  });
  assert.ok(res.status >= 400 && res.status < 500, `status ${res.status}`);
  assert.equal((await fetch(`${ctx.base}/api/health`)).status, 200);
});

test("campi extra nel multipart rifiutati", async () => {
  const img = jpeg();
  const h = await signAuth({ wallet: wallets.userCtrl, up: UP.user, purpose: "photo", content: img });
  const res = await postFile(ctx.base, img, h, { extraField: ["note", "x"] });
  assert.equal(res.status, 400);
});

test("una firma valida per un file non vale per un altro file", async () => {
  const signed = jpeg();
  const other = png();
  const h = await signAuth({ wallet: wallets.userCtrl, up: UP.user, purpose: "photo", content: signed });
  const res = await postFile(ctx.base, other, h);
  assert.equal(res.status, 400);
});

test("replay della stessa firma rifiutato", async () => {
  const img = jpeg();
  const h = await signAuth({ wallet: wallets.userCtrl, up: UP.user, purpose: "photo", content: img });
  assert.equal((await postFile(ctx.base, img, h)).status, 200);
  assert.equal((await postFile(ctx.base, img, h)).status, 401);
});

test("membership di testnet non sblocca il pin sul nodo di produzione", async () => {
  const img = jpeg();
  const h = await signAuth({ wallet: wallets.userCtrl, up: UP.user, purpose: "photo", content: img, chainId: 4201 });
  assert.equal((await postFile(ctx.base, img, h)).status, 400);
});

test("SVG/HTML dichiarati come immagine vengono rifiutati (tipo dai byte)", async () => {
  for (const payload of [
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    Buffer.from("<!doctype html><html><script>alert(document.domain)</script></html>")
  ]) {
    const h = await signAuth({ wallet: wallets.userCtrl, up: UP.user, purpose: "photo", content: payload });
    const form = new FormData();
    form.append("file", new Blob([payload], { type: "image/png" }), "x.png");
    const res = await fetch(`${ctx.base}/api/pin-file`, { method: "POST", headers: h, body: form });
    assert.equal(res.status, 400);
  }
});

test("foto con EXIF (es. GPS) rifiutata", async () => {
  const img = jpeg({ exif: true });
  const h = await signAuth({ wallet: wallets.userCtrl, up: UP.user, purpose: "photo", content: img });
  const res = await postFile(ctx.base, img, h);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /metadati/);
});

test("PDF ammesso solo come documento (Gold), non come foto", async () => {
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
  const h = await signAuth({ wallet: wallets.userCtrl, up: UP.user, purpose: "photo", content: pdf });
  assert.equal((await postFile(ctx.base, pdf, h)).status, 400);

  const h2 = await signAuth({ wallet: wallets.userCtrl, up: UP.user, purpose: "document", content: pdf });
  assert.equal((await postFile(ctx.base, pdf, h2)).status, 403, "Bronze non basta per i documenti");

  ctx.chain.setTier(UP.other, 3);
  const h3 = await signAuth({ wallet: wallets.otherCtrl, up: UP.other, purpose: "document", content: pdf });
  assert.equal((await postFile(ctx.base, pdf, h3)).status, 200);
});

test("senza membership né lista: foto rifiutata; con lista: ammessa", async () => {
  const local = await startApp();
  try {
    const img = jpeg();
    const h = await signAuth({ wallet: wallets.otherCtrl, up: UP.other, purpose: "photo", content: img });
    assert.equal((await postFile(local.base, img, h)).status, 403);

    fs.writeFileSync(local.config.allowedAddressesPath, JSON.stringify([UP.other]));
    const h2 = await signAuth({ wallet: wallets.otherCtrl, up: UP.other, purpose: "photo", content: img });
    assert.equal((await postFile(local.base, img, h2)).status, 200);
  } finally {
    await local.close();
  }
});

test("file oltre 5 MB: 413", async () => {
  const big = Buffer.concat([jpeg(), Buffer.alloc(5 * 1024 * 1024 + 10)]);
  const h = await signAuth({ wallet: wallets.userCtrl, up: UP.user, purpose: "photo", content: big });
  const res = await postFile(ctx.base, big, h);
  assert.equal(res.status, 413);
});

test("il file pinnato ha nome e tipo decisi dal server", async () => {
  const img = png();
  const h = await signAuth({ wallet: wallets.userCtrl, up: UP.user, purpose: "photo", content: img });
  const form = new FormData();
  form.append("file", new Blob([img], { type: "text/html" }), "../../evil.html");
  const res = await fetch(`${ctx.base}/api/pin-file`, { method: "POST", headers: h, body: form });
  assert.equal(res.status, 200);
  const last = ctx.ipfs.pinned.at(-1);
  assert.equal(last.mimetype, "image/png");
  assert.equal(last.filename, "mycarbook-photo.png");
});
