// Controlli statici sul codice servito: niente HTML da stringhe, niente
// codice/stili inline (CSP), niente CDN, testi non veritieri rimossi.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FE = join(ROOT, "frontend");

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const own = walk(FE).filter((p) => !p.includes(`${FE}/vendor`) && !p.includes(`${FE}/fonts`));
const html = own.filter((p) => p.endsWith(".html"));
const js = own.filter((p) => p.endsWith(".js"));

test("innerHTML solo tramite setHtml(html``)", () => {
  for (const f of js) {
    if (f.endsWith("lib/html.js")) continue;
    const src = readFileSync(f, "utf8");
    const bad = src.split("\n").filter((l) => /\.innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=|document\.write/.test(l));
    assert.deepEqual(bad, [], relative(ROOT, f));
  }
});

test("HTML senza script inline, gestori on*, stili inline", () => {
  for (const f of html) {
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, /<script(?![^>]*\bsrc=)[^>]*>/, `${relative(ROOT, f)}: <script> inline`);
    assert.doesNotMatch(src, /\son[a-z]+\s*=/i, `${relative(ROOT, f)}: gestore on*`);
    assert.doesNotMatch(src, /\sstyle\s*=/i, `${relative(ROOT, f)}: style=`);
    assert.doesNotMatch(src, /<style/i, `${relative(ROOT, f)}: <style>`);
  }
  for (const f of js) {
    assert.doesNotMatch(readFileSync(f, "utf8"), /style\s*=\s*\\?["']|setAttribute\(\s*["']style/, relative(ROOT, f));
  }
});

test("nessuna risorsa da CDN o Google Fonts", () => {
  for (const f of [...html, ...js, ...own.filter((p) => p.endsWith(".css"))]) {
    assert.doesNotMatch(readFileSync(f, "utf8"), /jsdelivr|esm\.sh|unpkg|googleapis|gstatic/, relative(ROOT, f));
  }
});

test("le librerie servite corrispondono a SHA256SUMS e all'integrity degli script", () => {
  const sums = readFileSync(join(FE, "vendor", "SHA256SUMS"), "utf8").trim().split("\n");
  for (const line of sums) {
    const [hash, file] = line.split(/\s+/);
    assert.equal(createHash("sha256").update(readFileSync(join(FE, file))).digest("hex"), hash, file);
  }
  for (const f of html) {
    for (const m of readFileSync(f, "utf8").matchAll(/<script src="(vendor\/[^"]+)" integrity="sha384-([^"]+)"/g)) {
      assert.equal(createHash("sha384").update(readFileSync(join(FE, m[1]))).digest("base64"), m[2], m[1]);
    }
  }
});

test("testi non veritieri rimossi (MCB-05, MCB-04, MCB-08, MCB-12, og:description)", () => {
  const files = [...html, ...js, join(ROOT, "README.md")];
  const forbidden = [
    /visible only to you/i, /visibili solo a te/i,
    /Nothing is ever deleted or overwritten/i, /Nulla viene mai cancellato o sovrascritto/i,
    /tamper-proof/i, /non falsificabile/i,
    /checked directly on-chain/i, /verificato direttamente on-chain/i,
    /No issuer, no backend/i
  ];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const re of forbidden) assert.doesNotMatch(src, re, `${relative(ROOT, f)}: ${re}`);
  }
});

test("chiavi di traduzione EN/IT allineate e usate dall'HTML esistono", async () => {
  const { I18N } = await import("../../frontend/js/i18n.js");
  assert.deepEqual(Object.keys(I18N.en).sort(), Object.keys(I18N.it).sort());
  const index = readFileSync(join(FE, "index.html"), "utf8");
  for (const m of index.matchAll(/data-i18n(?:-ph)?="([^"]+)"/g)) assert.ok(I18N.en[m[1]], m[1]);
  const app = readFileSync(join(FE, "js", "app.js"), "utf8");
  for (const m of app.matchAll(/\bt\("([A-Za-z]+)"/g)) assert.ok(I18N.en[m[1]], m[1]);
});
