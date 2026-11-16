
// Pannello admin (spostato da script inline per la CSP). Gli upload sono
// firmati con la UP owner (ADMIN_UP_ADDRESS sul backend); ADMIN_SIGNER_ADDRESS
// decide se basta un suo controller qualsiasi ("any") o una chiave precisa.
import { ERC725 } from "../vendor/erc725-0.28.2.esm.js";
import { signUploadHeaders } from "./lib/auth-message.js";
import { gatewayUrls } from "./lib/ipfs.js";

const logEl = document.getElementById("log");
function log(msg){ logEl.textContent += "\n" + msg; logEl.scrollTop = logEl.scrollHeight; }

let provider, signer, address, contract, chainId;

async function uploadImage(bytes){
  const headers = await signUploadHeaders({ signer, address, chainId, purpose: "admin", bytes });
  const formData = new FormData();
  formData.append("file", new Blob([bytes]), "upload");
  const res = await fetch("/api/pin-file", { method: "POST", headers, body: formData });
  if(!res.ok) throw new Error("upload fallito: " + (await res.text()));
  const data = await res.json();
  return data.cid;
}

async function pinJson(json){
  const bytes = new TextEncoder().encode(JSON.stringify(json));
  const headers = await signUploadHeaders({ signer, address, chainId, purpose: "admin", bytes });
  const res = await fetch("/api/pin-json", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: bytes
  });
  if(!res.ok) throw new Error("upload JSON fallito: " + (await res.text()));
  return (await res.json()).cid;
}

// L'immagine viene ricodificata (via EXIF/GPS): il backend rifiuta le
// immagini che contengono ancora metadati.
async function imageEntry(file){
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const hash = ethers.keccak256(bytes);
  const cid = await uploadImage(bytes);
  return {
    width: bitmap.width,
    height: bitmap.height,
    url: `ipfs://${cid}`,
    verification: { method: "keccak256(bytes)", data: hash }
  };
}

document.getElementById("btn-connect").addEventListener("click", async () => {
  const injected = window.lukso || window.ethereum;
  if(!injected){ log("Nessuna UP rilevata."); return; }

  provider = new ethers.BrowserProvider(injected);
  await injected.request({ method: "eth_requestAccounts" });
  signer = await provider.getSigner();
  address = await signer.getAddress();
  const network = await provider.getNetwork();
  chainId = Number(network.chainId);
  const netConfig = NETWORKS[chainId];
  if(!netConfig){ log("Rete non supportata: " + chainId); return; }

  contract = new ethers.Contract(netConfig.contractAddress, MYCARBOOK_ABI, signer);
  const owner = await contract.owner();

  document.getElementById("status").textContent = `${address} (rete ${chainId})`;
  log(`Connesso: ${address}`);
  log(`Owner contratto: ${owner}`);
  log(owner.toLowerCase() === address.toLowerCase()
    ? "✓ Sei l'owner, puoi procedere."
    : "✗ NON sei l'owner: il setData fallirà on-chain se procedi.");

  document.getElementById("btn-set-metadata").disabled = false;
  document.getElementById("btn-set-vehicle-image").disabled = false;
});

const schema = [{
  name: "LSP4Metadata",
  key: LSP4_METADATA_KEY,
  keyType: "Singleton",
  valueType: "bytes",
  valueContent: "VerifiableURI"
}];

document.getElementById("btn-set-metadata").addEventListener("click", async () => {
  try{
    const iconFile = document.getElementById("f-icon").files[0];
    const bannerFile = document.getElementById("f-banner").files[0];
    if(!iconFile){ log("Serve almeno l'icona."); return; }

    log("Upload icona sul nodo IPFS...");
    const icon = await imageEntry(iconFile);
    log("Icona caricata: " + icon.url);

    let images = [];
    if(bannerFile){
      log("Upload banner sul nodo IPFS...");
      const banner = await imageEntry(bannerFile);
      images = [[banner]];
      log("Banner caricato: " + banner.url);
    }

    const metadataJson = {
      LSP4Metadata: {
        name: "MyCarBook",
        description: "On-chain vehicle maintenance logbook on LUKSO. Owners mint their own vehicle and log service history directly from their Universal Profile.",
        links: [{ title: "Website", url: "https://mycarbook.chainintegrate.it" }],
        icon: [icon],
        images,
        assets: [],
        attributes: []
      }
    };

    log("Upload JSON metadata sul nodo IPFS...");
    const cid = await pinJson(metadataJson);
    log("JSON caricato: ipfs://" + cid);

    const encoded = ERC725.encodeData([{
      keyName: "LSP4Metadata",
      value: { json: metadataJson, url: `ipfs://${cid}` }
    }], schema);

    log("Invio setData alla UP per la firma...");
    const tx = await contract.setData(encoded.keys[0], encoded.values[0]);
    log("Transazione inviata: " + tx.hash);
    await tx.wait();
    log("✓ Fatto. Metadata di collezione impostata.");
  }catch(err){
    console.error(err);
    log("✗ Errore: " + (err.message || err));
  }
});

async function fetchIpfsJson(ipfsUrl){
  const gateways = gatewayUrls(ipfsUrl);
  if(gateways.length === 0) throw new Error("Link IPFS non valido: " + ipfsUrl);
  for(const url of gateways){
    try{
      const res = await fetch(url);
      if(res.ok) return await res.json();
    }catch(e){ /* prova il successivo */ }
  }
  throw new Error("Nessun gateway IPFS ha risposto per " + ipfsUrl);
}

document.getElementById("btn-set-vehicle-image").addEventListener("click", async () => {
  try{
    const tokenIdNum = document.getElementById("f-token-id").value;
    const imageFile = document.getElementById("f-vehicle-image").files[0];
    if(!tokenIdNum){ log("Inserisci un token ID."); return; }
    if(!imageFile){ log("Serve un'immagine."); return; }

    const tokenIdHex = ethers.zeroPadValue(ethers.toBeHex(BigInt(tokenIdNum)), 32);
    log(`Token ID ${tokenIdNum} -> ${tokenIdHex}`);

    log("Leggo il metadata attuale del veicolo...");
    const currentBytes = await contract.getDataForTokenId(tokenIdHex, LSP4_METADATA_KEY);
    if(!currentBytes || currentBytes === "0x"){
      throw new Error("Nessun metadata esistente per questo tokenId — verifica che il veicolo sia stato mintato.");
    }
    const decoded = ERC725.decodeData([{ keyName: "LSP4Metadata", value: currentBytes }], schema);
    const currentJson = await fetchIpfsJson(decoded[0].value.url);
    log("Metadata attuale: " + (currentJson.LSP4Metadata?.name || "(senza nome)"));

    log("Upload nuova immagine sul nodo IPFS...");
    const icon = await imageEntry(imageFile);
    log("Immagine caricata: " + icon.url);

    // Merge: mantengo name/attributes/description esistenti, sostituisco
    // solo icon/images — setDataForTokenId sovrascrive l'intero JSON, quindi
    // senza questo merge perderemmo marca/modello/targa/VIN già scritti.
    const mergedJson = {
      LSP4Metadata: {
        ...currentJson.LSP4Metadata,
        icon: [icon],
        images: [[icon]]
      }
    };

    log("Upload JSON aggiornato sul nodo IPFS...");
    const cid = await pinJson(mergedJson);
    log("JSON caricato: ipfs://" + cid);

    const encoded = ERC725.encodeData([{
      keyName: "LSP4Metadata",
      value: { json: mergedJson, url: `ipfs://${cid}` }
    }], schema);

    log("Invio setDataForTokenId alla UP per la firma...");
    const tx = await contract.setDataForTokenId(tokenIdHex, encoded.keys[0], encoded.values[0]);
    log("Transazione inviata: " + tx.hash);
    await tx.wait();
    log("✓ Fatto. Immagine del veicolo aggiornata.");
  }catch(err){
    console.error(err);
    log("✗ Errore: " + (err.message || err));
  }
});
