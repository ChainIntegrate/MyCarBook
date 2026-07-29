require("dotenv").config();
const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3008;
const PINATA_JWT = process.env.PINATA_JWT;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://mycarbook.chainintegrate.it";
const ALLOWED_ADDRESSES_PATH = path.join(__dirname, "allowed-addresses.json");

if (!PINATA_JWT) {
  console.error("PINATA_JWT mancante in .env — il backend non può avviarsi senza.");
  process.exit(1);
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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB, ampio margine per un'icona ≤800px
});

app.use(express.json({ limit: "1mb" })); // il JSON LSP4Metadata è piccolo, 1mb è già ampio margine

app.use(cors({ origin: ALLOWED_ORIGIN }));

// Limite per IP: questo endpoint costa (ogni chiamata pinna su Pinata a
// carico dell'account ChainIntegrate), quindi va protetto da abuso anche
// se il JWT non è mai esposto al browser.
const pinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minuti
  max: 20,                   // 20 pin per IP ogni 15 minuti
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Troppe richieste, riprova più tardi." }
});

app.post("/api/pin-json", pinLimiter, async (req, res) => {
  const metadataJson = req.body;

  if (!metadataJson || typeof metadataJson !== "object" || !metadataJson.LSP4Metadata) {
    return res.status(400).json({ error: "Payload non valido: atteso un oggetto con chiave LSP4Metadata." });
  }

  try {
    const response = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${PINATA_JWT}`
      },
      body: JSON.stringify({
        pinataContent: metadataJson,
        pinataMetadata: { name: "mycarbook-vehicle-metadata" }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Errore Pinata:", response.status, errText);
      return res.status(502).json({ error: "Pinata ha rifiutato la richiesta di pin." });
    }

    const data = await response.json();
    return res.json({ cid: data.IpfsHash });
  } catch (err) {
    console.error("Errore chiamata Pinata:", err);
    return res.status(500).json({ error: "Errore interno durante il pin su IPFS." });
  }
});

app.get("/api/photo-access/:address", (req, res) => {
  const address = (req.params.address || "").toLowerCase();
  const allowed = loadAllowedAddresses().includes(address);
  return res.json({ allowed });
});

// Upload immagine veicolo su Pinata — gate applicato lato UI (bottone visibile
// solo per indirizzi autorizzati), qui solo un controllo di ragionevolezza sul
// file; non è un confine di sicurezza, coerente con la scelta di non cifrare
// nulla nel progetto (il dato finale è comunque pubblico una volta on-chain).
const imageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Troppe richieste, riprova più tardi." }
});

app.post("/api/pin-file", imageLimiter, upload.single("image"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Nessun file immagine ricevuto." });
  }
  const allowedMimeTypes = req.file.mimetype.startsWith("image/") || req.file.mimetype === "application/pdf";
  if (!allowedMimeTypes) {
    return res.status(400).json({ error: "Il file deve essere un'immagine o un PDF." });
  }

  try {
    const form = new FormData();
    form.append("file", new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname || "vehicle-photo");
    form.append("pinataMetadata", JSON.stringify({ name: "mycarbook-vehicle-photo" }));

    const response = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
      method: "POST",
      headers: { Authorization: `Bearer ${PINATA_JWT}` },
      body: form
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Errore Pinata (file):", response.status, errText);
      return res.status(502).json({ error: "Pinata ha rifiutato il file." });
    }

    const data = await response.json();
    return res.json({ cid: data.IpfsHash });
  } catch (err) {
    console.error("Errore upload immagine su Pinata:", err);
    return res.status(500).json({ error: "Errore interno durante l'upload dell'immagine." });
  }
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`mycarbook-backend in ascolto sulla porta ${PORT}`);
});