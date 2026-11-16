"use strict";
// Autorizzazione degli upload tramite firma della Universal Profile
// (ERC-1271). Il messaggio firmato lega: dominio, scopo, indirizzo, rete,
// impronta SHA-256 del contenuto, nonce monouso e istante di emissione.
// Una firma vale quindi per UN solo file/JSON, UNA sola volta, solo su
// questo sito e solo sulle reti ammesse (audit MCB-09, MCB-03).
//
// IMPORTANTE: il formato del messaggio deve restare identico a
// frontend/js/lib/auth-message.js (un test lo verifica).

const { ethers } = require("ethers");

const PURPOSES = ["metadata", "photo", "document", "admin", "access"];
const HEADER = {
  address: "x-mcb-address",
  signature: "x-mcb-signature",
  chainId: "x-mcb-chain-id",
  purpose: "x-mcb-purpose",
  nonce: "x-mcb-nonce",
  issuedAt: "x-mcb-issued-at",
  sha256: "x-mcb-content-sha256"
};

const SHA256_EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function buildAuthMessage({ domain, purpose, address, chainId, sha256, nonce, issuedAt }) {
  return [
    "MyCarBook upload authorization",
    `domain: ${domain}`,
    `purpose: ${purpose}`,
    `address: ${String(address).toLowerCase()}`,
    `chainId: ${chainId}`,
    `sha256: ${String(sha256).toLowerCase()}`,
    `nonce: ${nonce}`,
    `issuedAt: ${issuedAt}`
  ].join("\n");
}

// Nonce già usati, tenuti in memoria solo fino alla scadenza della firma.
class NonceStore {
  constructor() { this.used = new Map(); }
  sweep(now) {
    for (const [n, exp] of this.used) if (exp <= now) this.used.delete(n);
  }
  has(nonce) { return this.used.has(nonce); }
  consume(nonce, expiresAt, now) {
    this.sweep(now);
    if (this.used.has(nonce)) return false;
    this.used.set(nonce, expiresAt);
    return true;
  }
}

function readAuthHeaders(req) {
  const h = {};
  for (const [k, name] of Object.entries(HEADER)) h[k] = req.get(name);
  return h;
}

class AuthError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/**
 * Verifica la firma. Non consuma il nonce: lo fa il chiamante quando il
 * contenuto ricevuto corrisponde all'impronta firmata (consumeNonce).
 */
async function verifyAuth({ headers, config, chain, nonces, now }) {
  const { address, signature, chainId: chainIdRaw, purpose, nonce, issuedAt: issuedAtRaw, sha256 } = headers;
  if (!address || !signature || !chainIdRaw || !purpose || !nonce || !issuedAtRaw || !sha256) {
    throw new AuthError(401, "Parametri di autenticazione mancanti.");
  }
  if (!PURPOSES.includes(purpose)) throw new AuthError(400, "purpose non valido.");
  if (!ethers.isAddress(address)) throw new AuthError(400, "Indirizzo non valido.");
  if (!/^0x[0-9a-fA-F]+$/.test(signature) || signature.length > 1000) throw new AuthError(400, "Firma non valida.");
  if (!/^[0-9a-f]{32}$/.test(nonce)) throw new AuthError(400, "Nonce non valido.");
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new AuthError(400, "Impronta del contenuto non valida.");
  if (!/^\d{1,16}$/.test(chainIdRaw) || !/^\d{1,16}$/.test(issuedAtRaw)) throw new AuthError(400, "Parametri non validi.");

  const chainId = Number(chainIdRaw);
  if (!config.allowedChainIds.includes(chainId)) throw new AuthError(400, "Rete non ammessa.");

  const issuedAt = Number(issuedAtRaw);
  const age = now - issuedAt;
  if (age > config.signatureMaxAgeMs || age < -config.signatureMaxSkewMs) {
    throw new AuthError(401, "Firma scaduta o orario non valido, riprova.");
  }
  if (nonces.has(nonce)) throw new AuthError(401, "Autorizzazione già usata, riprova.");

  const message = buildAuthMessage({ domain: config.authDomain, purpose, address, chainId, sha256, nonce, issuedAt });
  const hash = ethers.hashMessage(message);

  if (purpose === "admin") {
    // Legame con UNA chiave precisa: non basta un controller qualsiasi
    // della UP owner, deve firmare la chiave admin configurata.
    if (!config.adminUpAddress || !config.adminSignerAddress) {
      throw new AuthError(403, "Azioni admin non configurate su questo server.");
    }
    if (ethers.getAddress(address) !== config.adminUpAddress) {
      throw new AuthError(403, "Indirizzo non autorizzato per questa azione.");
    }
    let signer;
    try {
      signer = ethers.recoverAddress(hash, signature);
    } catch {
      throw new AuthError(401, "Firma non valida.");
    }
    if (signer !== config.adminSignerAddress) {
      throw new AuthError(403, "Chiave non autorizzata per le azioni admin.");
    }
  }

  let valid = false;
  try {
    valid = await chain.isValidSignature(chainId, address, hash, signature);
  } catch (err) {
    console.warn("Verifica firma fallita:", err.message);
    throw new AuthError(401, "Verifica firma fallita (indirizzo non è una UP valida su questa rete?).");
  }
  if (!valid) throw new AuthError(401, "Firma non valida.");

  return { address: ethers.getAddress(address), chainId, purpose, nonce, issuedAt, sha256 };
}

function consumeNonce({ auth, config, nonces, now }) {
  const ok = nonces.consume(auth.nonce, auth.issuedAt + config.signatureMaxAgeMs + config.signatureMaxSkewMs, now);
  if (!ok) throw new AuthError(401, "Autorizzazione già usata, riprova.");
}

module.exports = { buildAuthMessage, verifyAuth, consumeNonce, readAuthHeaders, NonceStore, AuthError, PURPOSES, HEADER, SHA256_EMPTY };
