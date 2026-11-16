// Flussi principali con CSP applicata: mint firmato (MCB-03), avviso
// targa/VIN (MCB-05), foto ripulita da EXIF (MCB-06), cambio lingua senza
// nuove letture (MCB-14), salto km (MCB-12), trasferimento (MCB-11),
// intestazioni del vhost (MCB-01/16), nessuna risorsa di terze parti.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { startEnv } from "./harness.mjs";
import { CONFIG } from "./chain-sim.mjs";

let env;
before(async () => { env = await startEnv({ tier: 1 }); });
after(async () => env && env.close());

async function clearToasts(page) {
  await page.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
}

async function toastText(page) {
  const el = await page.waitForSelector(".toast.error");
  const text = await el.textContent();
  await page.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
  return text;
}

test("intestazioni di sicurezza su pagine e API; file di servizio non esposti", async () => {
  const res = await env.page.request.get(`${env.nginx.base}/`);
  const h = res.headers();
  assert.match(h["content-security-policy"], /script-src 'self';/);
  assert.match(h["content-security-policy"], /frame-ancestors 'none'/);
  assert.match(h["content-security-policy"], /style-src 'self';/);
  assert.equal(h["x-content-type-options"], "nosniff");
  assert.equal(h["referrer-policy"], "strict-origin-when-cross-origin");
  const api = await env.page.request.get(`${env.nginx.base}/api/health`);
  assert.equal(api.headers()["x-content-type-options"], "nosniff");
  assert.equal(api.headers()["x-powered-by"], undefined);
  const vendor = await env.page.request.get(`${env.nginx.base}/vendor/ethers-6.13.4.umd.min.js`);
  assert.match(vendor.headers()["content-security-policy"], /script-src 'self'/, "anche nella location con cache");
  for (const p of ["/.env", "/js/package.json", "/backend/.env", "/.git/HEAD"]) {
    assert.equal((await env.page.request.get(`${env.nginx.base}${p}`)).status(), 404, p);
  }
});

test("le tre pagine si caricano senza violazioni CSP né richieste a terze parti", async () => {
  for (const p of ["/how-it-works.html", "/admin-collection.html", "/"]) {
    await env.page.goto(`${env.nginx.base}${p}`);
    await env.page.waitForLoadState("networkidle");
  }
  await env.connect();
  await env.page.waitForTimeout(300);
  assert.deepEqual(env.cspViolations, []);
  const external = env.requests.filter((u) => !u.startsWith(env.nginx.base) && !u.startsWith("https://ipfs.chainintegrate.it/") && !u.startsWith("https://api.universalprofile.cloud/"));
  assert.deepEqual(external, [], "niente Google Fonts, jsDelivr, esm.sh");
  const fontsOk = await env.page.evaluate(async () => {
    const loaded = await Promise.all(["16px Inter", "600 16px Oswald", "16px 'JetBrains Mono'"].map((f) => document.fonts.load(f)));
    return loaded.every((l) => l.length > 0);
  });
  assert.ok(fontsOk, "font serviti in locale");
  assert.match(await env.page.textContent("#list-empty, #list-not-connected"), /.*/);
});

test("testo di connessione: non dice più 'visibili solo a te'", async () => {
  const html = await (await env.page.request.get(`${env.nginx.base}/`)).text();
  assert.doesNotMatch(html, /visible only to you/);
  const app = await (await env.page.request.get(`${env.nginx.base}/js/i18n.js`)).text();
  assert.doesNotMatch(app, /visibili solo a te|visible only to you/);
});

test("mint con targa: senza presa d'atto non parte nulla; con presa d'atto JSON firmato e pinnato", async () => {
  const page = env.page;
  await page.click("#btn-new-vehicle");
  await page.fill("#f-brand", "Fiat");
  await page.fill("#f-plate", "AB123CD");
  await page.fill("#f-reg-date", "2020-01-01");
  await page.fill("#f-purchase-date", "2021-01-01");
  await page.fill("#f-km", "12000");
  assert.equal(await page.isVisible("#identity-ack-row"), true, "la presa d'atto compare con la targa");
  await page.click("#btn-mint-review");
  assert.match(await toastText(page), /plate and VIN|targa e VIN/);
  assert.equal(await page.isVisible("#mint-confirm"), false);

  await page.check("#i-identity-privacy-ack");
  await page.click("#btn-mint-review");
  await page.click("#mint-confirm button");
  await page.waitForFunction(() => document.querySelectorAll(".vehicle-card").length === 1, null, { timeout: 15000 });

  const mint = env.sim.sent.find((s) => s.name === "mintVehicle");
  assert.ok(mint, "transazione di mint inviata");
  assert.equal(env.backend.pinned.length, 1);
  const pinnedText = env.backend.pinned[0].bytes.toString();
  const pinnedJson = JSON.parse(pinnedText);
  assert.deepEqual(pinnedJson.LSP4Metadata.attributes.map((a) => a.key), ["Brand", "Plate"]);
  // VerifiableURI: keccak256 dei byte pinnati e URL del CID restituito
  const value = mint.args[3];
  assert.equal(ethers.dataSlice(value, 8, 40), ethers.keccak256(ethers.toUtf8Bytes(pinnedText)));
  assert.equal(ethers.toUtf8String(ethers.dataSlice(value, 40)), `ipfs://${env.backend.pinned[0].cid}`);
});

test("km fuori scala rifiutati prima della firma", async () => {
  const page = env.page;
  await page.click("#btn-new-vehicle");
  await page.fill("#f-brand", "Fiat");
  await page.fill("#f-reg-date", "2020-01-01");
  await page.fill("#f-purchase-date", "2021-01-01");
  await page.fill("#f-km", "99999999");
  await clearToasts(page);
  await page.click("#btn-mint-review");
  assert.match(await toastText(page), /2,000,000|2\.000\.000/);
  assert.equal(await page.isVisible("#mint-confirm"), false);
  await page.click("#view-mint .back-link");
});

test("foto con EXIF/GPS: caricata ripulita (il backend rifiuterebbe l'originale)", async () => {
  const page = env.page;
  // JPEG reale generato dal browser + segmento EXIF con coordinate GPS
  const jpegB64 = await page.evaluate(async () => {
    const c = document.createElement("canvas"); c.width = 64; c.height = 64;
    const ctx = c.getContext("2d"); ctx.fillStyle = "#c08552"; ctx.fillRect(0, 0, 64, 64);
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9));
    const b = new Uint8Array(await blob.arrayBuffer());
    return btoa(String.fromCharCode(...b));
  });
  const clean = Buffer.from(jpegB64, "base64");
  const exifPayload = Buffer.from("Exif\0\0GPSLatitude=45.4642N;GPSLongitude=9.1900E;SerialNumber=CAM123", "latin1");
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.from([(exifPayload.length + 2) >> 8, (exifPayload.length + 2) & 255]), exifPayload]);
  const withExif = Buffer.concat([clean.subarray(0, 2), app1, clean.subarray(2)]);

  const before = env.backend.pinned.length;
  await page.click("#btn-new-vehicle");
  await page.fill("#f-brand", "Lancia");
  await page.fill("#f-reg-date", "2020-01-01");
  await page.fill("#f-purchase-date", "2021-01-01");
  await page.fill("#f-km", "5000");
  await page.setInputFiles("#f-photo", { name: "IMG_0001.jpg", mimeType: "image/jpeg", buffer: withExif });
  await page.check("#i-photo-privacy-ack");
  await page.click("#btn-mint-review");
  await page.click("#mint-confirm button");
  await page.waitForFunction(() => document.querySelectorAll(".vehicle-card").length === 2, null, { timeout: 15000 });

  const photo = env.backend.pinned.slice(before).find((p) => p.mimetype.startsWith("image/"));
  assert.ok(photo, "foto pinnata");
  assert.equal(photo.bytes.includes(Buffer.from("GPSLatitude")), false);
  assert.equal(photo.bytes.includes(Buffer.from("Exif\0\0")), false);
  const json = JSON.parse(env.backend.pinned.at(-1).bytes.toString());
  assert.equal(json.LSP4Metadata.icon[0].url, `ipfs://${photo.cid}`);
  await page.waitForSelector(".vehicle-thumb-img");
});

test("cambio lingua nel dettaglio: nessuna nuova lettura dei log", async () => {
  const page = env.page;
  await page.click(".vehicle-card >> nth=0");
  await page.waitForFunction(() => !document.getElementById("view-detail").hidden);
  await page.waitForTimeout(500);
  const before = env.sim.count("eth_getLogs");
  assert.ok(before > 0);
  await page.click("#btn-lang");
  await page.click("#btn-lang");
  await page.waitForTimeout(300);
  assert.equal(env.sim.count("eth_getLogs"), before);
});

test("salto di km grande: serve una conferma esplicita prima della firma", async () => {
  const page = env.page;
  await page.click("#btn-new-intervention");
  await page.fill("#i-date", "2024-05-01");
  await page.fill("#i-km", "1000000");
  await page.fill("#i-desc", "Tagliando");
  await page.click("#btn-intervention-review");
  assert.equal(await page.isVisible("#i-km-jump-ack"), true);
  const sentBefore = env.sim.sent.length;
  await clearToasts(page);
  await page.click("#intervention-confirm button.btn-primary");
  assert.match(await toastText(page), /mileage|km/);
  assert.equal(env.sim.sent.length, sentBefore, "nessuna transazione");

  await page.fill("#i-km", "13000");
  await page.click("#btn-intervention-review");
  assert.equal(await page.isVisible("#i-km-jump-ack"), false);
  await page.click("#intervention-confirm button.btn-primary");
  await page.waitForFunction(() => document.querySelectorAll(".stamp-entry").length === 1, null, { timeout: 15000 });
  const logged = env.sim.sent.at(-1);
  assert.equal(logged.name, "logIntervention");
  assert.equal(logged.args[2], 13000n);
});

test("trasferimento: indirizzo non valido o proprio rifiutati; poi transfer con force=false", async () => {
  const page = env.page;
  await page.click("#btn-transfer");
  const sentBefore = env.sim.sent.length;
  for (const bad of ["0x123", env.sim.up, CONFIG.NETWORKS[42].contractAddress]) {
    await page.fill("#f-transfer-to", bad);
    await clearToasts(page);
    await page.click("#btn-transfer-confirm");
    await toastText(page);
  }
  assert.equal(env.sim.sent.length, sentBefore);
  const buyer = ethers.Wallet.createRandom().address;
  await page.fill("#f-transfer-to", buyer);
  await page.click("#btn-transfer-confirm");
  await page.waitForFunction(() => !document.getElementById("view-list").hidden, null, { timeout: 15000 });
  const tx = env.sim.sent.at(-1);
  assert.equal(tx.name, "transfer");
  assert.equal(tx.args[1], buyer);
  assert.equal(tx.args[3], false);
  assert.equal(await page.$$eval(".vehicle-card", (c) => c.length), 1);
});

test("nascondi un veicolo dalla lista e mostralo di nuovo", async () => {
  const page = env.page;
  await page.click(".vehicle-card >> nth=0");
  await page.click("#btn-hide-vehicle");
  await page.waitForFunction(() => !document.getElementById("view-list").hidden);
  assert.equal(await page.$$eval(".vehicle-card", (c) => c.length), 0);
  await page.click("#btn-show-hidden");
  assert.equal(await page.$$eval(".vehicle-card", (c) => c.length), 1);
  assert.deepEqual(env.cspViolations, []);
});
