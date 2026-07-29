const hre = require("hardhat");

// Owner della collezione (branding/LSP4Metadata a livello contratto) per
// rete — SEMPRE ChainIntegrate, ma indirizzo diverso tra test e main,
// separato deliberatamente dall'EOA deployer che paga solo il gas.
const COLLECTION_OWNER_BY_CHAIN = {
  4201: "0x83cBE526D949A3AaaB4EF9a03E48dd862e81472C", // UP ChainIntegrate testnet
  42:   "0x4a2605796e0d91A9667d6E30365aEEC384C48c27", // UP ChainIntegrate mainnet
};

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const chainId = hre.network.config.chainId;

  console.log("Deploying with account:", deployer.address);
  console.log("Network:", hre.network.name, "chainId:", chainId);

  const collectionOwner = COLLECTION_OWNER_BY_CHAIN[chainId];
  if (!collectionOwner || collectionOwner === "0x0000000000000000000000000000000000000000") {
    throw new Error(
      `Nessun collectionOwner configurato per chainId ${chainId}. ` +
      `Aggiorna COLLECTION_OWNER_BY_CHAIN in scripts/deploy-v2.js prima di procedere.`
    );
  }
  console.log("Collection owner (ChainIntegrate UP):", collectionOwner);

  // Nome/simbolo del token restano "MyCarBook"/"MCB" — è lo stesso prodotto,
  // solo un'interfaccia contratto aggiornata (fix km + categoryFlags).
  const collectionName = "MyCarBook";
  const collectionSymbol = "MCB";

  const MyCarBookV2 = await hre.ethers.getContractFactory("MyCarBookV2");
  const contract = await MyCarBookV2.deploy(collectionName, collectionSymbol, collectionOwner);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("\nMyCarBookV2 deployed at:", address);
  console.log("\n--> Copia questo indirizzo in frontend/config.js, chiave", hre.network.config.chainId, "\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
