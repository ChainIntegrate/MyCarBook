"use strict";
const crypto = require("crypto");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const multer = require("multer");

const { verifyAuth, consumeNonce, readAuthHeaders, NonceStore, AuthError, SHA256_EMPTY } = require("./auth");
const { checkUpload } = require("./files");
const { validateVehicleMetadata, validateAdminMetadata } = require("./metadata-schema");

const TIER_BRONZE = 1;
const TIER_GOLD = 3;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_JSON_BYTES = 32 * 1024;

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// Rilegge il file ad ogni chiamata (non in cache): la lista si modifica
// direttamente sul VPS senza riavviare il processo.
function loadAllowedAddresses(filePath) {
  try {
    const list = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!Array.isArray(list)) throw new Error("allowed-addresses.json deve contenere un array");
    return list.map((a) => String(a).toLowerCase());
  } catch (err) {
    if (err.code !== "ENOENT") console.error("Errore lettura allowed-addresses.json:", err.message);
    return [];
  }
}

/**
 * @param {object} deps
 * @param {object} deps.config  vedi lib/config.js
 * @param {object} deps.chain   { isValidSignature(chainId, address, hash, sig), tierOf(chainId, address) }
 * @param {object} deps.ipfs    { add(buffer, filename, mimetype) -> cid }
 * @param {object} [deps.ledger] { append(entry) }
 * @param {Function} [deps.now]
 */
function createApp({ config, chain, ipfs, ledger = { append() {} }, now = () => Date.now(), limits = {} }) {
  const app = express();
  const nonces = new NonceStore();

  // Dietro Nginx: senza questa riga req.ip è sempre 127.0.0.1 e il rate
  // limit diventa un unico contatore condiviso da tutti (audit MCB-02).
  app.set("trust proxy", config.trustProxy);
  app.disable("x-powered-by");
  app.use(cors({ origin: config.allowedOrigin }));

  const limiter = (max) => rateLimit({
    windowMs: 15 * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Troppe richieste, riprova più tardi." }
  });
  const jsonLimiter = limiter(limits.json ?? 20);
  const fileLimiter = limiter(limits.file ?? 10);
  const accessLimiter = limiter(limits.access ?? 20);

  async function tierOf(chainId, address) {
    try {
      return await chain.tierOf(chainId, address);
    } catch (err) {
      console.warn("Lettura tier membership fallita, tratto come 0:", err.message);
      return 0;
    }
  }

  async function isAuthorized(auth) {
    switch (auth.purpose) {
      case "metadata":
      case "access":
        return true; // basta una firma valida di una UP
      case "admin":
        return true; // legame con la chiave admin già verificato in verifyAuth
      case "photo": {
        if (loadAllowedAddresses(config.allowedAddressesPath).includes(auth.address.toLowerCase())) return true;
        return (await tierOf(auth.chainId, auth.address)) >= TIER_BRONZE;
      }
      case "document":
        return (await tierOf(auth.chainId, auth.address)) >= TIER_GOLD;
      default:
        return false;
    }
  }

  // Prima di tutto: senza firma la risposta è 401, qualunque sia il resto.
  function readHeaders(req) {
    const headers = readAuthHeaders(req);
    if (!headers.address || !headers.signature) throw new AuthError(401, "Parametri di autenticazione mancanti.");
    return headers;
  }

  function sendError(res, err) {
    if (err instanceof AuthError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    return res.status(500).json({ error: "Errore interno." });
  }

  // --- JSON LSP4Metadata (mint veicolo o pannello admin) ---------------
  // Il corpo viene pinnato byte per byte com'è arrivato: è lo stesso testo
  // di cui il frontend ha calcolato l'impronta (firma) e il keccak256
  // (VerifiableURI on-chain).
  app.post(
    "/api/pin-json",
    jsonLimiter,
    express.raw({ type: "application/json", limit: MAX_JSON_BYTES }),
    async (req, res) => {
      try {
        const headers = readHeaders(req);
        if (headers.purpose !== "metadata" && headers.purpose !== "admin") {
          throw new AuthError(400, "purpose non valido per questo endpoint.");
        }
        const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        if (raw.length === 0) throw new AuthError(400, "Corpo vuoto.");
        if (sha256Hex(raw) !== String(headers.sha256 || "").toLowerCase()) {
          throw new AuthError(400, "Il contenuto non corrisponde a quello firmato.");
        }
        let json;
        try {
          json = JSON.parse(raw.toString("utf8"));
        } catch {
          throw new AuthError(400, "JSON non valido.");
        }
        const schemaError = headers.purpose === "admin" ? validateAdminMetadata(json) : validateVehicleMetadata(json);
        if (schemaError) throw new AuthError(400, `Payload non valido: ${schemaError}.`);

        const t = now();
        const auth = await verifyAuth({ headers, config, chain, nonces, now: t });
        if (!(await isAuthorized(auth))) throw new AuthError(403, "Indirizzo non autorizzato per questa azione.");
        consumeNonce({ auth, config, nonces, now: t });

        let cid;
        try {
          cid = await ipfs.add(raw, "mycarbook-metadata.json", "application/json");
        } catch (err) {
          console.error("Errore pin JSON su IPFS:", err.message);
          return res.status(502).json({ error: "Errore durante il pin su IPFS." });
        }
        ledger.append({ cid, purpose: auth.purpose });
        return res.json({ cid });
      } catch (err) {
        return sendError(res, err);
      }
    }
  );

  // --- Verifica lista manuale foto (solo per la propria UP, firmata) ----
  app.post("/api/photo-access", accessLimiter, async (req, res) => {
    try {
      const headers = readHeaders(req);
      if (headers.purpose !== "access") throw new AuthError(400, "purpose non valido per questo endpoint.");
      if (String(headers.sha256 || "").toLowerCase() !== SHA256_EMPTY) throw new AuthError(400, "Impronta non valida.");
      const t = now();
      const auth = await verifyAuth({ headers, config, chain, nonces, now: t });
      consumeNonce({ auth, config, nonces, now: t });
      const allowed = loadAllowedAddresses(config.allowedAddressesPath).includes(auth.address.toLowerCase());
      return res.json({ allowed });
    } catch (err) {
      return sendError(res, err);
    }
  });

  // --- File: foto veicolo (Bronze+ o lista), documento (Gold), admin ----
  // Firma e permessi sono verificati PRIMA di leggere il file: una
  // richiesta anonima non arriva mai al parser multipart.
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 0, parts: 1 }
  });

  app.post(
    "/api/pin-file",
    fileLimiter,
    async (req, res, next) => {
      try {
        const headers = readHeaders(req);
        if (!["photo", "document", "admin"].includes(headers.purpose)) {
          throw new AuthError(400, "purpose non valido per questo endpoint.");
        }
        const t = now();
        const auth = await verifyAuth({ headers, config, chain, nonces, now: t });
        if (!(await isAuthorized(auth))) throw new AuthError(403, "Indirizzo non autorizzato per questa azione.");
        req.mcbAuth = auth;
        return next();
      } catch (err) {
        return sendError(res, err);
      }
    },
    (req, res, next) => {
      // Ogni errore del parser multipart (corpo troncato, campi extra, file
      // troppo grande) diventa una risposta 4xx: mai un crash.
      upload.single("file")(req, res, (err) => {
        if (!err) return next();
        const tooBig = err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE";
        return res.status(tooBig ? 413 : 400).json({ error: tooBig ? "File troppo grande (max 5MB)." : "Richiesta non valida." });
      });
    },
    async (req, res) => {
      try {
        const auth = req.mcbAuth;
        if (!req.file) throw new AuthError(400, "Nessun file ricevuto.");
        if (sha256Hex(req.file.buffer) !== auth.sha256) {
          throw new AuthError(400, "Il file non corrisponde a quello firmato.");
        }
        const check = checkUpload(req.file.buffer, auth.purpose === "admin" ? "photo" : auth.purpose);
        if (!check.ok) throw new AuthError(400, check.error);
        consumeNonce({ auth, config, nonces, now: now() });

        let cid;
        try {
          cid = await ipfs.add(req.file.buffer, check.filename, check.type);
        } catch (err) {
          console.error("Errore pin file su IPFS:", err.message);
          return res.status(502).json({ error: "Errore durante il pin su IPFS." });
        }
        ledger.append({ cid, purpose: auth.purpose });
        return res.json({ cid });
      } catch (err) {
        return sendError(res, err);
      }
    }
  );

  app.get("/api/health", (req, res) => res.json({ ok: true }));

  // Errori del parser (file troppo grande, multipart malformato, JSON
  // oltre il limite): risposta 4xx, mai un crash del processo.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      return res.status(status).json({ error: status === 413 ? "File troppo grande (max 5MB)." : "Richiesta non valida." });
    }
    if (err && (err.type === "entity.too.large" || err.status === 413)) {
      return res.status(413).json({ error: "Richiesta troppo grande." });
    }
    if (err && err.status >= 400 && err.status < 500) {
      return res.status(err.status).json({ error: "Richiesta non valida." });
    }
    console.error(err);
    return res.status(500).json({ error: "Errore interno." });
  });

  return app;
}

module.exports = { createApp, sha256Hex, MAX_FILE_BYTES, MAX_JSON_BYTES };
