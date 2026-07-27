require("dotenv").config();
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = process.env.PORT || 3008;
const PINATA_JWT = process.env.PINATA_JWT;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://mycarbook.chainintegrate.it";

if (!PINATA_JWT) {
  console.error("PINATA_JWT mancante in .env — il backend non può avviarsi senza.");
  process.exit(1);
}

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

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`mycarbook-backend in ascolto sulla porta ${PORT}`);
});
