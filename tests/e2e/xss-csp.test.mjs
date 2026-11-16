// MCB-01 (XSS memorizzato) e CSP: un veicolo "avvelenato" spinto nella UP
// della vittima e un intervento con marcatore [doc:] malevolo non devono
// eseguire nulla. Controprova: anche iniettando HTML con gestori inline o
// <script>, la CSP del vhost li blocca.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { startEnv } from "./harness.mjs";
import { encodeMetadataValue } from "./chain-sim.mjs";

const ICON_PAYLOAD = 'ipfs://x" onerror="window.__xss=\'icon\'" a="';
const DOC_PAYLOAD = 'ok [doc:ipfs://x" style="position:fixed;inset:0" onmouseover="window.__xss=\'doc\'" a="]';
const DESC_PAYLOAD = '<img src=x onerror="window.__xss=\'desc\'">tagliando';

let env, poisonedId, brokenId, goodId;
before(async () => {
  const poisonedJson = { LSP4Metadata: { name: "Auto <b>regalata</b>", attributes: [{ key: "Plate", value: '"><img src=x onerror=alert(1)>' }], icon: [{ url: ICON_PAYLOAD }] } };
  const brokenJson = { LSP4Metadata: { name: 42, attributes: "x", icon: [{ url: { not: "a string" } }] } };
  const goodJson = { LSP4Metadata: { name: "La mia Panda", attributes: [{ key: "Brand", value: "Fiat" }], icon: [] } };
  const files = {};
  const put = (json) => {
    const bytes = Buffer.from(JSON.stringify(json));
    const cid = "Qm" + ethers.encodeBase58(ethers.sha256(bytes)).padStart(44, "1").slice(0, 44);
    files[cid] = { bytes, type: "application/json" };
    return `ipfs://${cid}`;
  };
  const poisonedUrl = put(poisonedJson), brokenUrl = put(brokenJson), goodUrl = put(goodJson);
  env = await startEnv({
    ipfsFiles: files,
    setup(sim) {
      const attacker = ethers.Wallet.createRandom().address;
      // token mintato dall'attaccante e spinto alla vittima (LSP8 force=true)
      poisonedId = sim.addToken({ owner: sim.up, metadata: encodeMetadataValue(poisonedJson, poisonedUrl) });
      brokenId = sim.addToken({ owner: sim.up, metadata: encodeMetadataValue(brokenJson, brokenUrl) });
      goodId = sim.addToken({ owner: sim.up, metadata: encodeMetadataValue(goodJson, goodUrl) });
      sim.addInterventionLog({ tokenId: poisonedId, loggedBy: attacker, date: 1700000000n, km: 1000n, description: DOC_PAYLOAD });
      sim.addInterventionLog({ tokenId: poisonedId, loggedBy: attacker, date: 1700000001n, km: 1001n, description: DESC_PAYLOAD });
    }
  });
});
after(async () => env && env.close());

test("veicolo avvelenato: nessuno script eseguito nella lista, gli altri veicoli restano visibili", async () => {
  await env.connect();
  await env.page.waitForSelector(".vehicle-card");
  await env.page.waitForTimeout(500);
  const names = await env.page.$$eval(".vehicle-card-name", (els) => els.map((e) => e.textContent));
  assert.equal(names.length, 3, "anche il token malformato non rompe la lista (MCB-11)");
  assert.ok(names.includes("La mia Panda"));
  assert.ok(names.includes("Auto <b>regalata</b>"), "il nome è mostrato come testo");
  assert.equal(await env.page.evaluate(() => window.__xss), undefined);
  const handlers = await env.page.$$eval("*", (els) => els.filter((e) => [...e.attributes].some((a) => a.name.startsWith("on"))).length);
  assert.equal(handlers, 0, "nessun attributo on* nel DOM");
});

test("dettaglio: marcatore [doc:] malevolo e descrizione con HTML restano testo", async () => {
  await env.page.click(".vehicle-card >> nth=0");
  await env.page.waitForSelector(".stamp-entry");
  await env.page.mouse.move(200, 200);
  await env.page.hover(".stamp-entry >> nth=0");
  await env.page.waitForTimeout(300);
  assert.equal(await env.page.evaluate(() => window.__xss), undefined);
  assert.equal(await env.page.$$eval("a.doc-link", (a) => a.length), 0, "nessun link creato da un marcatore non valido");
  const descs = await env.page.$$eval(".stamp-card .desc", (els) => els.map((e) => e.textContent));
  assert.ok(descs.includes(DESC_PAYLOAD), "la descrizione è mostrata letteralmente");
  const pills = await env.page.$$eval("#detail-attrs .attr-pill", (els) => els.map((e) => e.textContent));
  assert.ok(pills.some((p) => p.includes('"><img src=x onerror=alert(1)>')));
  assert.equal(await env.page.$("#detail-photo:not([hidden])"), null, "icona non valida: nessuna foto");
});

test("controprova CSP: HTML iniettato con gestori inline o <script> viene bloccato", async () => {
  await env.page.evaluate(() => {
    document.body.insertAdjacentHTML("beforeend", '<img src="/nope.png" onerror="window.__csp=\'img\'">');
    const s = document.createElement("script");
    s.textContent = "window.__csp='script'";
    document.body.appendChild(s);
    const a = document.createElement("a");
    a.href = "javascript:window.__csp='href'";
    document.body.appendChild(a);
    a.click();
  });
  await env.page.waitForTimeout(500);
  assert.equal(await env.page.evaluate(() => window.__csp), undefined);
  assert.ok(env.cspViolations.some((v) => v.startsWith("script-src")), `violazioni: ${env.cspViolations.join(" | ")}`);
});

test("controprova: lo stesso payload esegue codice con la costruzione HTML della versione e38be66", async () => {
  // Riproduzione del problema: il template originale (index.html:1057).
  await env.page.goto("about:blank");
  const fired = await env.page.evaluate((icon) => new Promise((resolve) => {
    window.__xss = undefined;
    const resolveIpfsUrl = (u) => `https://example.invalid/ipfs/${u.replace("ipfs://", "")}`;
    const card = document.createElement("div");
    card.innerHTML = `<img src="${resolveIpfsUrl(icon)}" alt="" onerror="this.onerror=null; this.src='x';" />`;
    document.body.appendChild(card);
    setTimeout(() => resolve(window.__xss), 1000);
  }), ICON_PAYLOAD);
  assert.equal(fired, "icon");
});
