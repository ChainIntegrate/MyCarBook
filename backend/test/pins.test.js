"use strict";
// MCB-17 (file non pinnati sul nodo proprio), MCB-03/06 (pin orfani),
// MCB-13 (autenticazione verso l'API Kubo). Nodo Kubo e RPC simulati via HTTP.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { ethers } = require("ethers");
const { collectReferencedCids, iface, LSP4_METADATA_KEY } = require("../lib/cids");
const { createKubo } = require("../lib/kubo");
const { checkPins, repinOne, gcOrphans, backupCars } = require("../lib/pin-ops");

const cidOf = (s) => "Qm" + ethers.encodeBase58(ethers.sha256(ethers.toUtf8Bytes(s))).padStart(44, "1").slice(0, 44);
const META1 = cidOf("meta1"), META1_OLD = cidOf("meta1-old"), META2 = cidOf("meta2"), PHOTO = cidOf("photo"), DOC = cidOf("doc"), COLL = cidOf("coll"), COLL_ICON = cidOf("coll-icon");
const CONTRACT = "0x24e9cd569AC99B6DF47CA767508cF63105318195";

function vuri(url) {
  return ethers.concat(["0x0000", "0x6f357c6a", "0x0020", ethers.keccak256("0x01"), ethers.toUtf8Bytes(url)]);
}
function logOf(name, args, blockNumber) {
  const { topics, data } = iface.encodeEventLog(iface.getEvent(name), args);
  return { address: CONTRACT, topics, data, blockNumber };
}
const id1 = ethers.zeroPadValue("0x01", 32), id2 = ethers.zeroPadValue("0x02", 32);
const LOGS = [
  logOf("TokenIdDataChanged", [id1, LSP4_METADATA_KEY, vuri(`ipfs://${META1_OLD}`)], 100),
  logOf("TokenIdDataChanged", [id1, LSP4_METADATA_KEY, vuri(`ipfs://${META1}`)], 200),
  logOf("TokenIdDataChanged", [id2, LSP4_METADATA_KEY, vuri(`ipfs://${META2}`)], 300),
  logOf("InterventionLogged", [id1, CONTRACT, 1n, 1n, 0, 0n, `Tagliando [doc:ipfs://${DOC}]`], 400),
  logOf("InterventionLogged", [id1, CONTRACT, 1n, 1n, 0, 0n, 'x [doc:ipfs://x" onerror="a"]'], 401),
  logOf("DataChanged", [LSP4_METADATA_KEY, vuri(`ipfs://${COLL}`)], 500)
];
const JSONS = {
  [META1]: { LSP4Metadata: { icon: [{ url: `ipfs://${PHOTO}` }], images: [[{ url: `ipfs://${PHOTO}` }]] } },
  [META1_OLD]: { LSP4Metadata: { icon: [] } },
  [META2]: { LSP4Metadata: { icon: [{ url: 'ipfs://bad" x' }] } },
  [COLL]: { LSP4Metadata: { icon: [{ url: `ipfs://${COLL_ICON}` }] } }
};

function collect(overrides = {}) {
  return collectReferencedCids({
    contractAddress: CONTRACT,
    fromBlock: 50,
    windowSize: 100,
    getBlockNumber: async () => 600,
    getLogs: async (f) => LOGS.filter((l) => l.blockNumber >= f.fromBlock && l.blockNumber <= f.toBlock),
    fetchJson: async (cid) => { if (!JSONS[cid]) throw new Error("404"); return JSONS[cid]; },
    getData: async () => vuri(`ipfs://${COLL}`),
    ...overrides
  });
}

// --- Kubo simulato ---------------------------------------------------------
function startKubo({ pinned = [], carRoots = {}, requireAuth } = {}) {
  const pins = new Set(pinned);
  const seen = [];
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    const arg = u.searchParams.get("arg");
    seen.push({ path: u.pathname, auth: req.headers.authorization });
    const chunks = [];
    for await (const c of req) chunks.push(c);
    if (requireAuth && req.headers.authorization !== requireAuth) { res.writeHead(401); return res.end("unauthorized"); }
    const ok = (body) => { res.writeHead(200); res.end(typeof body === "string" ? body : JSON.stringify(body)); };
    switch (u.pathname) {
      case "/api/v0/pin/ls":
        if (pins.has(arg)) return ok({ Keys: { [arg]: { Type: "recursive" } } });
        res.writeHead(500); return res.end(JSON.stringify({ Message: `path '${arg}' is not pinned` }));
      case "/api/v0/pin/add":
        res.writeHead(500); return res.end(JSON.stringify({ Message: "context deadline exceeded" }));
      case "/api/v0/dag/import": {
        const body = Buffer.concat(chunks).toString("latin1");
        const root = Object.keys(carRoots).find((k) => body.includes(carRoots[k]));
        if (root) pins.add(root);
        return ok(root ? JSON.stringify({ Root: { Cid: { "/": root } } }) + "\n" : "");
      }
      case "/api/v0/pin/rm":
        pins.delete(arg); return ok({ Pins: [arg] });
      case "/api/v0/dag/export":
        if (!pins.has(arg)) { res.writeHead(500); return res.end("block not found"); }
        return ok(`CAR-${arg}`);
      case "/api/v0/cat":
        if (JSONS[arg] && pins.has(arg)) return ok(JSONS[arg]);
        res.writeHead(500); return res.end("not found");
      default:
        res.writeHead(404); return res.end();
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({
    url: `http://127.0.0.1:${server.address().port}`, pins, seen, close: () => new Promise((r) => server.close(r))
  })));
}

test("raccoglie metadata (anche sostituiti), foto, documenti, collezione; ignora link non validi", async () => {
  const { cids, unreadable } = await collect();
  assert.deepEqual([...cids.keys()].sort(), [META1, META1_OLD, META2, PHOTO, DOC, COLL, COLL_ICON].sort());
  assert.deepEqual(unreadable, []);
});

test("check: un file non pinnato sul nodo viene segnalato", async () => {
  const kubo = await startKubo({ pinned: [META1, META2, DOC, COLL, COLL_ICON, META1_OLD] });
  try {
    const { cids } = await collect();
    const r = await checkPins({ cids, kubo: createKubo({ apiUrl: kubo.url }) });
    assert.deepEqual(r.missing, [PHOTO]);
  } finally { await kubo.close(); }
});

test("repin: un CAR con radice diversa dal CID atteso NON viene accettato", async () => {
  const wrongRoot = cidOf("altro");
  const kubo = await startKubo({ carRoots: { [wrongRoot]: "FAKECAR" } });
  try {
    const fetchImpl = async () => new Response("FAKECAR-bytes");
    const r = await repinOne({ cid: PHOTO, kubo: createKubo({ apiUrl: kubo.url }), gateways: ["https://gw.invalid"], fetchImpl, pinAddTimeoutMs: 1000 });
    assert.equal(r.ok, false);
    assert.equal(kubo.pins.has(PHOTO), false);
    assert.equal(kubo.pins.has(wrongRoot), false, "la radice estranea importata viene tolta");
  } finally { await kubo.close(); }
});

test("repin: CAR corretto dal gateway => pinnato", async () => {
  const kubo = await startKubo({ carRoots: { [PHOTO]: "GOODCAR" } });
  try {
    const fetchImpl = async (url) => { assert.match(url, /\?format=car$/); return new Response("GOODCAR-bytes"); };
    const r = await repinOne({ cid: PHOTO, kubo: createKubo({ apiUrl: kubo.url }), gateways: ["https://gw.invalid"], fetchImpl, pinAddTimeoutMs: 1000 });
    assert.equal(r.ok, true);
    assert.ok(kubo.pins.has(PHOTO));
  } finally { await kubo.close(); }
});

test("pulizia orfani: mai i CID referenziati, mai se l'elenco è incompleto, mai i recenti", async () => {
  const kubo = await startKubo({ pinned: [META1, cidOf("orfano-vecchio"), cidOf("orfano-recente")] });
  try {
    const k = createKubo({ apiUrl: kubo.url });
    const { cids } = await collect();
    const now = Date.now();
    const ledger = [
      { cid: META1, at: new Date(now - 10 * 86400e3).toISOString() },
      { cid: cidOf("orfano-vecchio"), at: new Date(now - 10 * 86400e3).toISOString() },
      { cid: cidOf("orfano-recente"), at: new Date(now - 3600e3).toISOString() }
    ];
    const aborted = await gcOrphans({ ledger, referenced: cids, unreadable: [META2], kubo: k, now, apply: true });
    assert.ok(aborted.aborted);
    assert.equal(kubo.pins.size, 3);

    const dry = await gcOrphans({ ledger, referenced: cids, unreadable: [], kubo: k, now });
    assert.deepEqual(dry.candidates, [cidOf("orfano-vecchio")]);
    assert.equal(kubo.pins.size, 3, "senza --apply non rimuove nulla");

    await gcOrphans({ ledger, referenced: cids, unreadable: [], kubo: k, now, apply: true });
    assert.ok(kubo.pins.has(META1));
    assert.ok(kubo.pins.has(cidOf("orfano-recente")));
    assert.equal(kubo.pins.has(cidOf("orfano-vecchio")), false);
  } finally { await kubo.close(); }
});

test("backup: CAR + manifest con SHA-256; i mancanti sono segnalati", async () => {
  const kubo = await startKubo({ pinned: [META1, DOC] });
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "mcb-bak-"));
  try {
    const cids = new Map([[META1, "m"], [DOC, "d"], [PHOTO, "p"]]);
    const r = await backupCars({ cids, kubo: createKubo({ apiUrl: kubo.url }), outDir: out });
    assert.equal(r.saved, 2);
    assert.deepEqual(r.failed.map((f) => f.cid), [PHOTO]);
    const manifest = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8"));
    for (const item of manifest.items) {
      const bytes = fs.readFileSync(path.join(out, item.file));
      assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), item.sha256);
    }
  } finally { await kubo.close(); }
});

test("API Kubo con autenticazione: senza intestazione rifiutata, con IPFS_API_AUTH accettata", async () => {
  const kubo = await startKubo({ pinned: [META1], requireAuth: "Basic dXNlcjpwYXNz" });
  try {
    await assert.rejects(createKubo({ apiUrl: kubo.url }).isPinned(META1), /401/);
    assert.equal(await createKubo({ apiUrl: kubo.url, auth: "Basic dXNlcjpwYXNz" }).isPinned(META1), true);
  } finally { await kubo.close(); }
});

test("CLI check-pins: esce con 1 se manca un file (RPC e Kubo simulati)", async () => {
  const kubo = await startKubo({ pinned: [META1, META1_OLD, META2, DOC, COLL, COLL_ICON] });
  const rpc = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const one = (r) => {
      const hex = (n) => "0x" + n.toString(16);
      let result;
      if (r.method === "eth_chainId") result = "0x2a";
      else if (r.method === "eth_blockNumber") result = hex(8072041 + 600);
      else if (r.method === "eth_call") result = ethers.AbiCoder.defaultAbiCoder().encode(["bytes"], [vuri(`ipfs://${COLL}`)]);
      else if (r.method === "eth_getLogs") {
        const from = Number(r.params[0].fromBlock) - 8072041, to = Number(r.params[0].toBlock) - 8072041;
        result = LOGS.filter((l) => l.blockNumber >= from && l.blockNumber <= to).map((l, i) => ({
          ...l, blockNumber: hex(8072041 + l.blockNumber), blockHash: "0x" + "ab".repeat(32), transactionHash: "0x" + "cd".repeat(32), transactionIndex: "0x0", logIndex: hex(i), removed: false
        }));
      }
      return { jsonrpc: "2.0", id: r.id, result };
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(Array.isArray(body) ? body.map(one) : one(body)));
  });
  await new Promise((r) => rpc.listen(0, "127.0.0.1", r));
  try {
    const env = { ...process.env, IPFS_API_URL: kubo.url, RPC_URL_42: `http://127.0.0.1:${rpc.address().port}`, GATEWAY_FALLBACKS: "http://127.0.0.1:9" };
    const run = () => new Promise((resolve) => execFile(process.execPath, [path.join(__dirname, "..", "scripts", "check-pins.js")], { env }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr })));
    const r = await run();
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`MANCANTE ${PHOTO}`));
    kubo.pins.add(PHOTO);
    const r2 = await run();
    assert.equal(r2.code, 0, r2.stdout + r2.stderr);
    assert.match(r2.stdout, /tutti i file sono pinnati/);
  } finally {
    await kubo.close();
    await new Promise((r) => rpc.close(r));
  }
});
