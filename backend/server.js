require("dotenv").config();
const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const { ethers } = require("ethers");

const app = express();
const PORT = process.env.PORT || 3008;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://mycarbook.chainintegrate.it";
const ALLOWED_ADDRESSES_PATH = path.join(__dirname, "allowed-addresses.json");

// Nodo IPFS personale (Kubo), non più Pinata. La porta 5001 è raggiungibile
// solo dall'IP di questo VPS (whitelist UFW lato nodo) — nessuna API key
// necessaria, la protezione è a livello di rete, coerente con com'è già
// configurato il resto dell'infrastruttura.
const IPFS_API_URL = process.env.IPFS_API_URL || "http://161.97.130.81:5001";

if (!process.env.IPFS_API_URL) {
  console.warn("IPFS_API_URL non impostato in .env, uso il default hardcoded — meglio impostarlo esplicitamente.");
}

// --- Verifica firma ERC-1271 (stesso pattern già in uso su MatchPredictor v3) ---
// Gli upload "gated" (foto veicolo, documento intervento, azioni admin) non
// si fidano più solo del bottone disabilitato lato UI: il chiamante deve
// firmare un messaggio con la propria UP, verificato qui via isValidSignature
// prima di autorizzare il pin. Chi chiama l'endpoint direttamente (bypassando
// il bottone) senza una firma valida viene respinto.

const RPC_URLS = {
  4201: "https://rpc.testnet.lukso.network",
  42: "https://rpc.mainnet.lukso.network"
};

const MEMBERSHIP_ADDRESSES = {
  4201: "0x01D0930B375d037FA988b02871812D291cC0131D",
  42: "0x29437B2F70fa4812524bdd052fFF1bD8d8cD9beC"
};

const OWNER_ADDRESSES = {
  4201: "0x83cBE526D949A3AaaB4EF9a03E48dd862e81472C",
  42: "0x4a2605796e0d91A9667d6E30365aEEC384C48c27"
};

const MEMBERSHIP_ABI = ["function tierOf(address member) external view returns (uint8)"];
const UP_ABI = ["function isValidSignature(bytes32 hash, bytes memory signature) public view returns (bytes4)"];
const ERC1271_MAGIC_VALUE = "0x1626ba7e";
const TIER_BRONZE = 1;
const TIER_GOLD = 3;
const SIGNATURE_VALIDITY_MS = 5 * 60 * 1000; // 5 minuti, anti-replay

const providers = {};
function getProvider(chainId) {
  if (!providers[chainId]) {
    providers[chainId] = new ethers.JsonRpcProvider(RPC_URLS[chainId]);
  }
  return providers[chainId];
}

function buildAuthMessage({ purpose, address, chainId, timestamp }) {
  return `MyCarBook upload authorization\npurpose: ${purpose}\naddress: ${address}\nchainId: ${chainId}\ntimestamp: ${timestamp}`;
}

// Rilegge il file ad ogni chiamata (non in cache): Simone modifica
// allowed-addresses.json direttamente sul VPS con nano, senza bisogno di
// riavviare il processo PM2 per far comparire/sparire un indirizzo.
function loadAllowedAddresses() {
  try {
    const raw = fs.readFileSync(ALLOWED_ADDRESSES_PATH, "utf8");
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) throw new Error("allowed-addresses.json deve contenere un array");
    return list.map((a) => a.toLowerCase());
  } catch (err) {
    console.error("Errore lettura allowed-addresses.json:", err);
    return [];
  }
}

async function verifySignature({ address, signature, chainId, purpose, timestamp }) {
  if (!address || !signature || !chainId || !purpose || !timestamp) {
    return { ok: false, reason: "Parametri di autenticazione mancanti." };
  }
  if (!["photo", "document", "admin"].includes(purpose)) {
    return { ok: false, reason: "purpose non valido." };
  }
  if (!RPC_URLS[chainId]) {
    return { ok: false, reason: "chainId non supportata." };
  }

  const age = Date.now() - Number(timestamp);
  if (Number.isNaN(age) || age < 0 || age > SIGNATURE_VALIDITY_MS) {
    return { ok: false, reason: "Firma scaduta o timestamp non valido, riprova." };
  }

  try {
    const message = buildAuthMessage({ purpose, address, chainId, timestamp });
    const hash = ethers.hashMessage(message);
    const provider = getProvider(Number(chainId));
    const upContract = new ethers.Contract(address, UP_ABI, provider);
    const result = await upContract.isValidSignature(hash, signature);
    if (result.toLowerCase() !== ERC1271_MAGIC_VALUE) {
      return { ok: false, reason: "Firma non valida." };
    }
    return { ok: true };
  } catch (err) {
    console.warn("Verifica firma fallita:", err.message);
    return { ok: false, reason: "Verifica firma fallita (indirizzo non è una UP valida su questa rete?)." };
  }
}

async function checkAuthorization({ address, chainId, purpose }) {
  const addr = address.toLowerCase();

  if (purpose === "admin") {
    const owner = OWNER_ADDRESSES[chainId];
    return !!owner && addr === owner.toLowerCase();
  }

  let tier = 0;
  try {
    const provider = getProvider(Number(chainId));
    const membershipAddress = MEMBERSHIP_ADDRESSES[chainId];
    if (membershipAddress && membershipAddress !== "0x0000000000000000000000000000000000000000") {
      const membershipContract = new ethers.Contract(membershipAddress, MEMBERSHIP_ABI, provider);
      tier = Number(await membershipContract.tierOf(address));
    }
  } catch (err) {
    console.warn("Lettura tier membership fallita, tratto come 0:", err.message);
  }

  if (purpose === "photo") {
    const allowedByList = loadAllowedAddresses().includes(addr);
    return allowedByList || tier >= TIER_BRONZE;
  }

  if (purpose === "document") {
    return tier >= TIER_GOLD;
  }

  return false;
}

// --- Upload verso il nodo IPFS personale ---
async function pinToIpfs(buffer, filename, mimetype) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mimetype }), filename);

  const response = await fetch(`${IPFS_API_URL}/api/v0/add?pin=true`, {
    method: "POST",
    body: form
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Nodo IPFS ha rifiutato l'upload: ${response.status} ${errText}`);
  }

  const text = await response.text();
  const data = JSON.parse(text.trim());
  return data.Hash;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB, ampio margine per un'icona ≤800px
});

app.use(express.json({ limit: "1mb" })); // il JSON LSP4Metadata è piccolo, 1mb è già ampio margine

app.use(cors({ origin: ALLOWED_ORIGIN }));

// /api/pin-json resta SENZA gate di firma: serve anche per il mint base
// (nome/attributes), che è permissionless per design — non è una feature
// a fasce come foto/documento, quindi non ha senso richiedere una firma qui.
// Resta comunque protetto dal solo rate limit.
const jsonLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Troppe richieste, riprova più tardi." }
});

app.post("/api/pin-json", jsonLimiter, async (req, res) => {
  const metadataJson = req.body;

  if (!metadataJson || typeof metadataJson !== "object" || !metadataJson.LSP4Metadata) {
    return res.status(400).json({ error: "Payload non valido: atteso un oggetto con chiave LSP4Metadata." });
  }

  try {
    const buffer = Buffer.from(JSON.stringify(metadataJson));
    const cid = await pinToIpfs(buffer, "mycarbook-metadata.json", "application/json");
    return res.json({ cid });
  } catch (err) {
    console.error("Errore pin JSON su IPFS:", err);
    return res.status(502).json({ error: "Errore durante il pin su IPFS." });
  }
});

app.get("/api/photo-access/:address", (req, res) => {
  const address = (req.params.address || "").toLowerCase();
  const allowed = loadAllowedAddresses().includes(address);
  return res.json({ allowed });
});

// /api/pin-file è invece un endpoint "gated" reale: foto veicolo (Bronze+),
// documento intervento (Gold), o azioni admin (owner del contratto) — il
// chiamante deve firmare un messaggio con la propria UP, verificato via
// ERC-1271 PRIMA di autorizzare il pin. Il bottone disabilitato lato UI
// resta solo una comodità di UX, non è più l'unica barriera.
const fileLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Troppe richieste, riprova più tardi." }
});

app.post("/api/pin-file", fileLimiter, upload.single("image"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Nessun file ricevuto." });
  }
  const allowedMimeTypes = req.file.mimetype.startsWith("image/") || req.file.mimetype === "application/pdf";
  if (!allowedMimeTypes) {
    return res.status(400).json({ error: "Il file deve essere un'immagine o un PDF." });
  }

  const { address, signature, chainId, purpose, timestamp } = req.body;

  const sigCheck = await verifySignature({ address, signature, chainId: Number(chainId), purpose, timestamp });
  if (!sigCheck.ok) {
    return res.status(401).json({ error: sigCheck.reason });
  }

  const authorized = await checkAuthorization({ address, chainId: Number(chainId), purpose });
  if (!authorized) {
    return res.status(403).json({ error: "Indirizzo non autorizzato per questa azione." });
  }

  try {
    const cid = await pinToIpfs(req.file.buffer, req.file.originalname || "mycarbook-file", req.file.mimetype);
    return res.json({ cid });
  } catch (err) {
    console.error("Errore pin file su IPFS:", err);
    return res.status(502).json({ error: "Errore durante il pin su IPFS." });
  }
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, "127.0.0.1", () => {
  console.log(`mycarbook-backend in ascolto sulla porta ${PORT}`);
});
