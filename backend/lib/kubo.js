"use strict";
// Operazioni sui pin del nodo Kubo usate da check-pins / repin / backup.
const { createIpfsClient } = require("./ipfs");

function createKubo({ apiUrl, auth, fetchImpl = fetch }) {
  const client = createIpfsClient({ apiUrl, auth, fetchImpl });

  async function isPinned(cid) {
    try {
      const text = await client.call(`pin/ls?arg=${encodeURIComponent(cid)}&type=recursive`, { timeout: 30000 });
      return text.includes(cid);
    } catch (err) {
      if (/not pinned|is not pinned/i.test(err.message)) return false;
      throw err;
    }
  }

  return {
    isPinned,
    async pinAdd(cid, timeoutMs = 120000) {
      await client.call(`pin/add?arg=${encodeURIComponent(cid)}`, { timeout: timeoutMs });
      return isPinned(cid);
    },
    // Importa un CAR (verificato blocco per blocco da Kubo) e restituisce i root.
    async dagImport(carBytes) {
      const form = new FormData();
      form.append("file", new Blob([carBytes]), "import.car");
      const text = await client.call("dag/import?pin-roots=true&stats=false", { body: form, timeout: 300000 });
      return text.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((o) => o.Root).map((o) => o.Root.Cid["/"]);
    },
    async pinRm(cid) {
      await client.call(`pin/rm?arg=${encodeURIComponent(cid)}`, { timeout: 60000 });
    },
    async dagExport(cid) {
      const res = await fetchImpl(`${apiUrl}/api/v0/dag/export?arg=${encodeURIComponent(cid)}`, {
        method: "POST",
        headers: auth ? { Authorization: auth } : {},
        signal: AbortSignal.timeout(300000)
      });
      if (!res.ok) throw new Error(`dag/export ${cid}: ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
    async catJson(cid) {
      const text = await client.call(`cat?arg=${encodeURIComponent(cid)}&length=1048576`, { timeout: 30000 });
      return JSON.parse(text);
    }
  };
}

module.exports = { createKubo };
