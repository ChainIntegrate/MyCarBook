// Ambiente end-to-end: backend reale (createApp) con catena e nodo IPFS
// simulati, Nginx reale con il vhost e le intestazioni di deploy/nginx
// (TLS self-signed), Chromium via Playwright con una finta estensione UP.
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { ethers } from "ethers";
import { ChainSim } from "./chain-sim.mjs";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { createApp } = require(join(ROOT, "backend", "lib", "app.js"));
const { loadConfig } = require(join(ROOT, "backend", "lib", "config.js"));
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

async function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

export function fakeCid(bytes) {
  const b58 = ethers.encodeBase58(ethers.sha256(bytes));
  return "Qm" + b58.padStart(44, "1").slice(0, 44);
}

async function startBackend(sim, { adminSigner, adminUp } = {}) {
  const store = new Map(); // cid -> { bytes, type }
  const pinned = [];
  const dir = mkdtempSync(join(tmpdir(), "mcb-e2e-"));
  writeFileSync(join(dir, "allowed.json"), "[]");
  const config = loadConfig({
    IPFS_API_URL: "http://ipfs.invalid",
    ALLOWED_ADDRESSES_PATH: join(dir, "allowed.json"),
    ADMIN_UP_ADDRESS: adminUp || "",
    ADMIN_SIGNER_ADDRESS: adminSigner || ""
  });
  const chain = {
    async isValidSignature(chainId, address, hash, signature) {
      if (address.toLowerCase() !== sim.up.toLowerCase()) return false;
      return ethers.recoverAddress(hash, signature) === sim.controller.address;
    },
    async tierOf(chainId, address) { return sim.tiers.get(address.toLowerCase()) || 0; }
  };
  const ipfs = {
    async add(buffer, filename, mimetype) {
      const bytes = new Uint8Array(buffer);
      const cid = fakeCid(bytes);
      store.set(cid, { bytes: Buffer.from(bytes), type: mimetype });
      pinned.push({ cid, bytes: Buffer.from(bytes), filename, mimetype });
      return cid;
    }
  };
  const app = createApp({ config, chain, ipfs });
  const port = await freePort();
  const server = await new Promise((r) => { const s = app.listen(port, "127.0.0.1", () => r(s)); });
  return { port, store, pinned, close: () => new Promise((r) => server.close(r)) };
}

async function startNginx(backendPort) {
  const dir = mkdtempSync(join(tmpdir(), "mcb-nginx-"));
  mkdirSync(join(dir, "logs"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=localhost", "-days", "1",
    "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem")], { stdio: "ignore" });
  const port = await freePort();
  // Vhost di produzione con soli percorsi/porte adattati all'ambiente di test.
  let vhost = readFileSync(join(ROOT, "deploy", "nginx", "mycarbook.conf"), "utf8");
  vhost = vhost.slice(vhost.indexOf("server {", vhost.indexOf("return 301")))
    .replace("listen 443 ssl http2;", `listen 127.0.0.1:${port} ssl;`)
    .replace("listen [::]:443 ssl http2;", "")
    .replace("# ssl_certificate     /etc/letsencrypt/live/mycarbook.chainintegrate.it/fullchain.pem;", `ssl_certificate ${join(dir, "cert.pem")};`)
    .replace("# ssl_certificate_key /etc/letsencrypt/live/mycarbook.chainintegrate.it/privkey.pem;", `ssl_certificate_key ${join(dir, "key.pem")};`)
    .replace("root /var/www/mycarbook/frontend;", `root ${join(ROOT, "frontend")};`)
    .replace("proxy_pass http://127.0.0.1:3008;", `proxy_pass http://127.0.0.1:${backendPort};`)
    .replaceAll("/etc/nginx/snippets/mycarbook-security-headers.conf", join(ROOT, "deploy", "nginx", "security-headers.conf"));
  const conf = `daemon off; worker_processes 1; pid ${join(dir, "nginx.pid")}; error_log ${join(dir, "logs", "error.log")};
events { worker_connections 64; }
http { include /etc/nginx/mime.types; default_type application/octet-stream; access_log off;
  client_body_temp_path ${dir}/cb; proxy_temp_path ${dir}/px; fastcgi_temp_path ${dir}/fc; uwsgi_temp_path ${dir}/uw; scgi_temp_path ${dir}/sc;
  ${vhost} }`;
  writeFileSync(join(dir, "nginx.conf"), conf);
  execFileSync("nginx", ["-t", "-p", dir, "-c", join(dir, "nginx.conf")], { stdio: "pipe" });
  const proc = spawn("nginx", ["-p", dir, "-c", join(dir, "nginx.conf")], { stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    const open = await new Promise((r) => { const c = net.connect(port, "127.0.0.1", () => { c.end(); r(true); }); c.on("error", () => r(false)); });
    if (open) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return { port, base: `https://127.0.0.1:${port}`, close: () => proc.kill("SIGTERM") };
}

/**
 * Avvia tutto. `ipfsFiles` sono file già "presenti" sui gateway (cid -> {bytes,type}).
 */
export async function startEnv({ tier = 0, ipfsFiles = {}, setup } = {}) {
  const controller = ethers.Wallet.createRandom();
  const up = ethers.Wallet.createRandom().address;
  const sim = new ChainSim({ upAddress: up, controller });
  sim.setTier(up, tier);
  if (setup) await setup(sim);
  const backend = await startBackend(sim);
  for (const [cid, f] of Object.entries(ipfsFiles)) backend.store.set(cid, f);
  const nginx = await startNginx(backend.port);

  const browser = await chromium.launch();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  const requests = [];
  const cspViolations = [];
  const consoleErrors = [];
  page.on("request", (r) => requests.push(r.url()));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
    if (m.text().startsWith("CSP-VIOLATION ")) cspViolations.push(m.text().slice(14));
  });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  // Gateway IPFS (nodo proprio e LUKSO): servono i file "pinnati".
  const serveIpfs = async (route) => {
    const cid = new URL(route.request().url()).pathname.split("/")[2];
    const f = backend.store.get(cid);
    if (!f) return route.fulfill({ status: 404, body: "not found" });
    return route.fulfill({ status: 200, body: f.bytes, contentType: f.type });
  };
  await context.route("https://ipfs.chainintegrate.it/**", serveIpfs);
  await context.route("https://api.universalprofile.cloud/**", serveIpfs);
  // Qualunque altro host esterno: bloccato e registrato (non deve servire).
  await context.route(/^https?:\/\/(?!127\.0\.0\.1|ipfs\.chainintegrate\.it|api\.universalprofile\.cloud)/, (route) => route.abort());

  await page.exposeFunction("__mcbRpc", async (payload) => {
    try {
      const result = await sim.handle(JSON.parse(payload));
      return JSON.stringify({ result });
    } catch (err) {
      return JSON.stringify({ error: { code: -32000, message: err.message } });
    }
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      console.log("CSP-VIOLATION " + e.violatedDirective + " " + (e.blockedURI || "inline"));
    });
    window.lukso = {
      isUniversalProfileExtension: true,
      async request({ method, params }) {
        const out = JSON.parse(await window.__mcbRpc(JSON.stringify({ method, params })));
        if (out.error) { const err = new Error(out.error.message); err.code = out.error.code; throw err; }
        return out.result;
      },
      on() {}, removeListener() {}
    };
  });

  return {
    sim, backend, nginx, browser, context, page, requests, cspViolations, consoleErrors,
    async connect() {
      await page.goto(`${nginx.base}/`);
      await page.click("#btn-connect");
      await page.waitForFunction(() => document.getElementById("btn-connect").classList.contains("connected"));
    },
    async close() {
      await browser.close();
      nginx.close();
      await backend.close();
    }
  };
}

export { ROOT };
