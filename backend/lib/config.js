"use strict";
// Configurazione del backend, letta da variabili d'ambiente (.env sul VPS).
// Nessun valore "di sicurezza" ha un default nel codice: se manca, la
// funzione relativa resta disattivata (fail closed).

const { ethers } = require("ethers");

const MEMBERSHIP_ADDRESSES = {
  4201: "0x01D0930B375d037FA988b02871812D291cC0131D",
  42: "0x29437B2F70fa4812524bdd052fFF1bD8d8cD9beC"
};

const DEFAULT_RPC_URLS = {
  4201: "https://rpc.testnet.lukso.network",
  42: "https://rpc.mainnet.lukso.network"
};

function parseAddress(value, name) {
  if (!value) return null;
  if (!ethers.isAddress(value)) {
    throw new Error(`${name} non è un indirizzo valido`);
  }
  return ethers.getAddress(value);
}

function parseChainIds(value) {
  const ids = String(value || "42")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  for (const id of ids) {
    if (!DEFAULT_RPC_URLS[id]) throw new Error(`chainId ${id} non supportata`);
  }
  return ids;
}

function parseTrustProxy(value) {
  if (value === undefined || value === "") return "loopback";
  if (value === "false") return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

function loadConfig(env = process.env) {
  const allowedChainIds = parseChainIds(env.ALLOWED_CHAIN_IDS);
  const rpcUrls = {};
  for (const id of allowedChainIds) {
    rpcUrls[id] = env[`RPC_URL_${id}`] || DEFAULT_RPC_URLS[id];
  }

  return {
    port: Number(env.PORT || 3008),
    allowedOrigin: env.ALLOWED_ORIGIN || "https://mycarbook.chainintegrate.it",
    // Dominio scritto nel messaggio firmato: una firma raccolta da un altro
    // sito non è valida qui.
    authDomain: env.AUTH_DOMAIN || "mycarbook.chainintegrate.it",
    // Solo mainnet per default: una membership di testnet non deve
    // sbloccare il pin sul nodo di produzione (MCB-09).
    allowedChainIds,
    rpcUrls,
    membershipAddresses: MEMBERSHIP_ADDRESSES,
    // Admin = UP owner del contratto (obbligatoria). ADMIN_SIGNER_ADDRESS:
    // - "any": qualunque controller della UP owner con permesso SIGN
    //   (verificato on-chain da isValidSignature / KeyManager);
    // - un indirizzo: solo quella chiave controller;
    // - vuoto: azioni admin disattivate (un errore di configurazione non
    //   deve aprire l'accesso).
    // Da aggiornare quando l'ownership verrà spostata.
    adminUpAddress: parseAddress(env.ADMIN_UP_ADDRESS, "ADMIN_UP_ADDRESS"),
    adminSignerAny: String(env.ADMIN_SIGNER_ADDRESS || "").trim().toLowerCase() === "any",
    adminSignerAddress: String(env.ADMIN_SIGNER_ADDRESS || "").trim().toLowerCase() === "any"
      ? null
      : parseAddress(env.ADMIN_SIGNER_ADDRESS, "ADMIN_SIGNER_ADDRESS"),
    ipfsApiUrl: env.IPFS_API_URL || null,
    // Intestazione Authorization verso l'API Kubo (API.Authorizations,
    // Kubo >= 0.25), es. "Basic dXNlcjpwYXNz" oppure "Bearer ...".
    ipfsApiAuth: env.IPFS_API_AUTH || null,
    pinLedgerPath: env.PIN_LEDGER_PATH || require("path").join(__dirname, "..", "data", "pins.jsonl"),
    allowedAddressesPath: env.ALLOWED_ADDRESSES_PATH || require("path").join(__dirname, "..", "allowed-addresses.json"),
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    signatureMaxAgeMs: 5 * 60 * 1000,
    signatureMaxSkewMs: 60 * 1000
  };
}

module.exports = { loadConfig, MEMBERSHIP_ADDRESSES, DEFAULT_RPC_URLS };
