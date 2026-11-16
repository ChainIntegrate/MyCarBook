"use strict";
// Client minimale verso l'API Kubo del nodo IPFS proprio.
const fs = require("fs");
const path = require("path");

function createIpfsClient({ apiUrl, auth, fetchImpl = fetch, timeoutMs = 60000 }) {
  if (!apiUrl) throw new Error("IPFS_API_URL non impostato");
  const headers = auth ? { Authorization: auth } : {};

  async function call(endpoint, { body, timeout = timeoutMs } = {}) {
    const res = await fetchImpl(`${apiUrl}/api/v0/${endpoint}`, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(timeout)
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Kubo ${endpoint}: ${res.status} ${text.slice(0, 200)}`);
    return text;
  }

  return {
    call,
    async add(buffer, filename, mimetype) {
      const form = new FormData();
      form.append("file", new Blob([buffer], { type: mimetype }), filename);
      const text = await call("add?pin=true&cid-version=0", { body: form });
      return JSON.parse(text.trim().split("\n").pop()).Hash;
    }
  };
}

// Registro dei pin fatti dal backend (CID, scopo, istante; nessun
// indirizzo). Serve al job di controllo per togliere i pin "orfani":
// file caricati per un mint/intervento poi annullato (MCB-03, MCB-06).
function createPinLedger(filePath) {
  return {
    append(entry) {
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.appendFileSync(filePath, JSON.stringify({ ...entry, at: new Date().toISOString() }) + "\n");
      } catch (err) {
        console.error("Scrittura registro pin fallita:", err.message);
      }
    }
  };
}

module.exports = { createIpfsClient, createPinLedger };
