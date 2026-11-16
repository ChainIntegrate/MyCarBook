// MCB-01 / MCB-11: escape, link IPFS, costruzione DOM, metadata difensivi.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { escapeHtml, html, setHtml } from "../../frontend/js/lib/html.js";
import { parseIpfsUri, gatewayUrls, parseDocMarker, isSafeIpfsUri } from "../../frontend/js/lib/ipfs.js";
import { createVehicleCard, createTimelineEntry } from "../../frontend/js/lib/render.js";
import { sanitizeVehicleMetadata } from "../../frontend/js/lib/metadata.js";

const CID = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
const ICON_PAYLOAD = 'ipfs://x" onerror="alert(document.domain)" a="';
const DOC_PAYLOAD = 'ok [doc:ipfs://x" style="position:fixed;inset:0" onmouseover="alert(document.domain)" a="]';

const dom = () => new JSDOM("<!doctype html><body></body>").window.document;

test("escapeHtml copre anche le virgolette (attributi)", () => {
  assert.equal(escapeHtml(`"'<>&\`=`), "&quot;&#39;&lt;&gt;&amp;&#96;&#61;");
  assert.equal(escapeHtml(null), "");
});

test("html`` esegue l'escape di ogni valore; setHtml rifiuta stringhe semplici", () => {
  const doc = dom();
  const div = doc.createElement("div");
  setHtml(div, html`<span title="${ICON_PAYLOAD}">${"<img src=x onerror=alert(1)>"}</span>`);
  assert.equal(div.querySelector("img"), null);
  assert.equal(div.querySelector("span").getAttribute("title"), ICON_PAYLOAD);
  assert.equal(div.querySelector("span").attributes.length, 1, "nessun attributo extra iniettato");
  assert.throws(() => setHtml(div, "<b>x</b>"), TypeError);
});

test("link IPFS: accettati solo ipfs://CID; payload rifiutati", () => {
  assert.deepEqual(parseIpfsUri(`ipfs://${CID}`), { cid: CID, path: "" });
  assert.ok(isSafeIpfsUri(`ipfs://${CID}/foto.jpg`));
  for (const bad of [ICON_PAYLOAD, "javascript:alert(1)", `ipfs://${CID}"`, `ipfs://${CID}/../x`, `https://evil/${CID}`, `ipfs://${CID} x`, 42, null, { url: 1 }]) {
    assert.equal(parseIpfsUri(bad), null, String(bad));
    assert.deepEqual(gatewayUrls(bad), []);
  }
  assert.equal(gatewayUrls(`ipfs://${CID}`)[0], `https://ipfs.chainintegrate.it/ipfs/${CID}`);
});

test("marcatore [doc:] non valido resta testo; valido diventa link", () => {
  assert.deepEqual(parseDocMarker(DOC_PAYLOAD), { text: DOC_PAYLOAD, docUri: null });
  assert.deepEqual(parseDocMarker(`Tagliando [doc:ipfs://${CID}]`), { text: "Tagliando", docUri: `ipfs://${CID}` });
  assert.deepEqual(parseDocMarker(undefined), { text: "", docUri: null });
});

test("scheda veicolo: icona con payload => nessuna <img>, nessun gestore", () => {
  const doc = dom();
  const card = createVehicleCard(doc, { name: '<img src=x onerror="alert(1)">', icon: ICON_PAYLOAD }, { kmText: "1 km" });
  assert.equal(card.querySelector("img"), null);
  assert.equal(card.querySelector(".vehicle-card-name").textContent, '<img src=x onerror="alert(1)">');
  assert.equal([...card.querySelectorAll("*")].some((e) => [...e.attributes].some((a) => a.name.startsWith("on"))), false, "nessun attributo on*");

  const ok = createVehicleCard(doc, { name: "Panda", icon: `ipfs://${CID}` }, { kmText: "1 km" });
  const img = ok.querySelector("img");
  assert.equal(img.getAttribute("src"), `https://ipfs.chainintegrate.it/ipfs/${CID}`);
  assert.deepEqual([...img.attributes].map((a) => a.name).sort(), ["alt", "class", "src"]);
});

test("voce di storico: marcatore malevolo non crea link; descrizione solo testo", () => {
  const doc = dom();
  const view = { day: "01", month: "JAN", yearShort: "24", kmText: "1 km", amountLabel: null, categoryLabels: [], viewDocumentLabel: "Doc" };
  const entry = createTimelineEntry(doc, { description: DOC_PAYLOAD }, view);
  assert.equal(entry.querySelector("a"), null);
  assert.equal(entry.querySelector(".desc").textContent, DOC_PAYLOAD);
  assert.equal([...entry.querySelectorAll("*")].some((e) => [...e.attributes].some((a) => a.name.startsWith("on") || a.name === "style")), false);

  const good = createTimelineEntry(doc, { description: `Fattura [doc:ipfs://${CID}]` }, view);
  const a = good.querySelector("a");
  assert.equal(a.getAttribute("href"), `https://ipfs.chainintegrate.it/ipfs/${CID}`);
  assert.equal(a.getAttribute("rel"), "noopener noreferrer");
});

test("controprova: il template originale (index.html:1057 di e38be66) produce un onerror", () => {
  const doc = dom();
  const resolveIpfsUrl = (u, pub) => `${pub ? "https://api.universalprofile.cloud" : "https://ipfs.chainintegrate.it"}/ipfs/${u.replace("ipfs://", "")}`;
  const div = doc.createElement("div");
  div.innerHTML = `<img src="${resolveIpfsUrl(ICON_PAYLOAD)}" alt="" onerror="this.onerror=null; this.src='${resolveIpfsUrl(ICON_PAYLOAD, true)}';" style="width:100%" />`;
  assert.equal(div.querySelector("img").getAttribute("onerror"), "alert(document.domain)");
});

test("metadata malformati (token spinto da terzi) non lanciano eccezioni", () => {
  for (const bad of [null, 42, "x", { LSP4Metadata: null }, { LSP4Metadata: { name: 7, attributes: "x", icon: [{ url: { a: 1 } }] } },
    { LSP4Metadata: { attributes: [null, 1, { key: 1, value: 2 }], icon: "ipfs://x" } }]) {
    const m = sanitizeVehicleMetadata(bad);
    assert.equal(m.icon, null);
    assert.ok(Array.isArray(m.attributes));
  }
  const m = sanitizeVehicleMetadata({ LSP4Metadata: { name: "Panda", attributes: [{ key: "Brand", value: "Fiat" }], icon: [{ url: ICON_PAYLOAD }] } });
  assert.deepEqual(m, { name: "Panda", attributes: [{ key: "Brand", value: "Fiat" }], icon: null });
});
