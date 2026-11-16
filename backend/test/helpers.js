"use strict";
// Strumenti comuni ai test: UP simulate (ERC-1271 con controller ECDSA,
// come LSP6), nodo IPFS finto, firma degli upload come fa il frontend.
const crypto = require("crypto");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { ethers } = require("ethers");
const { createApp } = require("../lib/app");
const { loadConfig } = require("../lib/config");
const { buildAuthMessage } = require("../lib/auth");

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function makeChain() {
  const ups = new Map(); // upAddress(lower) -> Set(controller lower)
  const tiers = new Map();
  const calls = { isValidSignature: 0 };
  return {
    calls,
    addUp(up, controllers) { ups.set(up.toLowerCase(), new Set(controllers.map((c) => c.toLowerCase()))); },
    setTier(addr, tier) { tiers.set(addr.toLowerCase(), tier); },
    async isValidSignature(chainId, address, hash, signature) {
      calls.isValidSignature++;
      const set = ups.get(address.toLowerCase());
      if (!set) throw new Error("not a UP");
      let signer;
      try { signer = ethers.recoverAddress(hash, signature); } catch { return false; }
      return set.has(signer.toLowerCase());
    },
    async tierOf(chainId, address) { return tiers.get(address.toLowerCase()) || 0; }
  };
}

function makeIpfs() {
  const pinned = [];
  return {
    pinned,
    async add(buffer, filename, mimetype) {
      pinned.push({ buffer: Buffer.from(buffer), filename, mimetype });
      return "Qm" + sha256Hex(buffer).slice(0, 44);
    }
  };
}

function tmpFile(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcb-"));
  const p = path.join(dir, name);
  if (content !== undefined) fs.writeFileSync(p, content);
  return p;
}

const wallets = {
  userCtrl: ethers.Wallet.createRandom(),
  otherCtrl: ethers.Wallet.createRandom(),
  adminKey: ethers.Wallet.createRandom(),
  ownerOtherKey: ethers.Wallet.createRandom()
};
const UP = {
  user: ethers.Wallet.createRandom().address,
  other: ethers.Wallet.createRandom().address,
  owner: ethers.Wallet.createRandom().address
};

async function startApp({ env = {}, limits, now } = {}) {
  const chain = makeChain();
  chain.addUp(UP.user, [wallets.userCtrl.address]);
  chain.addUp(UP.other, [wallets.otherCtrl.address]);
  // La UP owner ha DUE controller: la chiave admin e un'altra chiave.
  chain.addUp(UP.owner, [wallets.adminKey.address, wallets.ownerOtherKey.address]);
  const ipfs = makeIpfs();
  const ledgerEntries = [];
  const config = loadConfig({
    IPFS_API_URL: "http://ipfs.invalid",
    ADMIN_UP_ADDRESS: UP.owner,
    ADMIN_SIGNER_ADDRESS: wallets.adminKey.address,
    ALLOWED_ADDRESSES_PATH: tmpFile("allowed.json", "[]"),
    ...env
  });
  const app = createApp({ config, chain, ipfs, ledger: { append: (e) => ledgerEntries.push(e) }, limits, now });
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, chain, ipfs, config, ledgerEntries, close: () => new Promise((r) => server.close(r)) };
}

async function signAuth({ wallet, up, purpose, content, chainId = 42, domain = "mycarbook.chainintegrate.it", issuedAt = Date.now(), nonce = crypto.randomBytes(16).toString("hex"), sha256 }) {
  const digest = sha256 || sha256Hex(content || Buffer.alloc(0));
  const message = buildAuthMessage({ domain, purpose, address: up, chainId, sha256: digest, nonce, issuedAt });
  const signature = await wallet.signMessage(message);
  return {
    "X-MCB-Address": up,
    "X-MCB-Signature": signature,
    "X-MCB-Chain-Id": String(chainId),
    "X-MCB-Purpose": purpose,
    "X-MCB-Nonce": nonce,
    "X-MCB-Issued-At": String(issuedAt),
    "X-MCB-Content-SHA256": digest
  };
}

function vehicleMetadata(overrides = {}) {
  return {
    LSP4Metadata: {
      name: "La mia Panda",
      description: "On-chain maintenance logbook — MyCarBook.",
      links: [],
      icon: [],
      images: [],
      assets: [],
      attributes: [{ key: "Brand", value: "Fiat", type: "string" }],
      ...overrides
    }
  };
}

function postJson(base, bodyString, headers = {}) {
  return fetch(`${base}/api/pin-json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: bodyString
  });
}

function postFile(base, buffer, headers = {}, { field = "file", extraField } = {}) {
  const form = new FormData();
  form.append(field, new Blob([buffer]), "x.bin");
  if (extraField) form.append(extraField[0], extraField[1]);
  return fetch(`${base}/api/pin-file`, { method: "POST", headers, body: form });
}

// Immagini minime valide (senza metadati) e con EXIF.
function jpeg({ exif = false } = {}) {
  const soi = Buffer.from([0xff, 0xd8]);
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1")]);
  const exifPayload = Buffer.from("Exif\0\0GPS-45.4642N-9.19E", "latin1");
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.from([0, exifPayload.length + 2]), exifPayload]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9]);
  return Buffer.concat([soi, app0, ...(exif ? [app1] : []), sos]);
}
function png() {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("\0\0\0\0IEND\xaeB`\x82", "latin1")]);
}

module.exports = { startApp, signAuth, wallets, UP, sha256Hex, vehicleMetadata, postJson, postFile, jpeg, png, tmpFile };
