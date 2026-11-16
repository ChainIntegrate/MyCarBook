require("dotenv").config();
const { loadConfig } = require("./lib/config");
const { createApp } = require("./lib/app");
const { createChain } = require("./lib/chain");
const { createIpfsClient, createPinLedger } = require("./lib/ipfs");

const config = loadConfig();

if (!config.ipfsApiUrl) {
  console.error("IPFS_API_URL non impostato in .env: impossibile avviare il backend.");
  process.exit(1);
}
if (!config.adminUpAddress || !config.adminSignerAddress) {
  console.warn("ADMIN_UP_ADDRESS / ADMIN_SIGNER_ADDRESS non impostati: upload admin disattivati.");
}

const app = createApp({
  config,
  chain: createChain(config),
  ipfs: createIpfsClient({ apiUrl: config.ipfsApiUrl, auth: config.ipfsApiAuth }),
  ledger: createPinLedger(config.pinLedgerPath)
});

// Solo loopback: raggiungibile esclusivamente tramite Nginx.
app.listen(config.port, "127.0.0.1", () => {
  console.log(`mycarbook-backend in ascolto sulla porta ${config.port} (reti ammesse: ${config.allowedChainIds.join(", ")})`);
});
