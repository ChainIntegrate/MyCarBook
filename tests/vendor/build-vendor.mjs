// Rigenera le librerie e i font serviti dal nostro dominio (audit MCB-16):
//   frontend/vendor/ethers-6.13.4.umd.min.js   (file npm originale, invariato)
//   frontend/vendor/erc725-0.28.2.esm.js       (bundle ESM di @erc725/erc725.js)
//   frontend/fonts/*.woff2 + frontend/css/fonts.css (latin + latin-ext)
//   frontend/vendor/SHA256SUMS
// Uso: cd tests && npm ci && npm run vendor
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const nm = join(here, "..", "node_modules");
const vendorDir = join(root, "frontend", "vendor");
const fontsDir = join(root, "frontend", "fonts");
const cssDir = join(root, "frontend", "css");

rmSync(vendorDir, { recursive: true, force: true });
rmSync(fontsDir, { recursive: true, force: true });
mkdirSync(vendorDir, { recursive: true });
mkdirSync(fontsDir, { recursive: true });
mkdirSync(cssDir, { recursive: true });

// 1. ethers: stesso file che serviva jsDelivr (pacchetto npm 6.13.4)
copyFileSync(join(nm, "ethers", "dist", "ethers.umd.min.js"), join(vendorDir, "ethers-6.13.4.umd.min.js"));

// 2. erc725.js come modulo ES autonomo (prima ricompilato da esm.sh a ogni richiesta)
await build({
  stdin: { contents: 'export { ERC725 } from "@erc725/erc725.js";', resolveDir: here },
  nodePaths: [nm],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  minify: true,
  legalComments: "eof",
  define: { "process.env.NODE_ENV": '"production"', global: "globalThis" },
  outfile: join(vendorDir, "erc725-0.28.2.esm.js"),
  logLevel: "warning"
});

// 3. Font: solo i pesi usati e i sottoinsiemi latin / latin-ext
const fonts = [
  { pkg: "oswald", weights: [500, 600, 700] },
  { pkg: "inter", weights: [400, 500, 600] },
  { pkg: "jetbrains-mono", weights: [400, 500, 700] }
];
let css = "/* Generato da tests/vendor/build-vendor.mjs — font serviti dal nostro dominio (SIL OFL 1.1, vedi fonts/LICENSE-*). */\n";
for (const { pkg, weights } of fonts) {
  const base = join(nm, "@fontsource", pkg);
  copyFileSync(join(base, "LICENSE"), join(fontsDir, `LICENSE-${pkg}.txt`));
  for (const w of weights) {
    // il file per peso contiene tutti i sottoinsiemi, ciascuno con il suo unicode-range
    const all = readFileSync(join(base, `${w}.css`), "utf8");
    for (const subset of ["latin-ext", "latin"]) {
      const file = `${pkg}-${subset}-${w}-normal.woff2`;
      const block = all.split("/* ").find((b) => b.startsWith(`${pkg}-${subset}-${w}-normal */`));
      if (!block) throw new Error(`blocco ${file} non trovato`);
      copyFileSync(join(base, "files", file), join(fontsDir, file));
      css += "/* " + block
        .replace(/src:[^;]+;/, `src: url(../fonts/${file}) format('woff2');`)
        .trim() + "\n";
    }
  }
}
writeFileSync(join(cssDir, "fonts.css"), css);

// 4. Impronte
const lines = [];
for (const dir of [vendorDir, fontsDir]) {
  for (const f of readdirSync(dir).sort()) {
    const p = join(dir, f);
    lines.push(`${createHash("sha256").update(readFileSync(p)).digest("hex")}  ${dir === vendorDir ? "vendor" : "fonts"}/${f}`);
  }
}
writeFileSync(join(vendorDir, "SHA256SUMS"), lines.join("\n") + "\n");

for (const f of ["ethers-6.13.4.umd.min.js", "erc725-0.28.2.esm.js"]) {
  const sri = createHash("sha384").update(readFileSync(join(vendorDir, f))).digest("base64");
  console.log(`${f}  integrity="sha384-${sri}"`);
}
