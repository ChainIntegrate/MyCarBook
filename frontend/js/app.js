"use strict";
// MyCarBook — logica della pagina principale.
// Spostata da index.html in un file (audit MCB-01/MCB-16): con la
// Content-Security-Policy il browser esegue solo codice servito dal sito,
// niente script inline né gestori "onerror=" iniettati.
//
// Dipendenze globali caricate prima da index.html: ethers (vendor/,
// servito dal nostro dominio) e config.js.

import { ERC725 } from "../vendor/erc725-0.28.2.esm.js";
import { I18N } from "./i18n.js";
import { html, setHtml } from "./lib/html.js";
import { gatewayUrls } from "./lib/ipfs.js";
import { sanitizeVehicleMetadata } from "./lib/metadata.js";
import { createVehicleCard, createTimelineEntry, setImageWithFallback } from "./lib/render.js";
import { signUploadHeaders } from "./lib/auth-message.js";
import { validateKm, kmJumpCheck, needsIdentityAck, validateAttributeLengths, validateTransferTarget, LIMITS } from "./lib/validation.js";
import { createLogCache } from "./lib/log-cache.js";
import { createHiddenList } from "./lib/hidden.js";
import { reencodeImage } from "./lib/image.js";

const LSP4_SCHEMA = [{
  name: "LSP4Metadata",
  key: LSP4_METADATA_KEY,
  keyType: "Singleton",
  valueType: "bytes",
  valueContent: "VerifiableURI"
}];

function safeStorage(){
  try{ return window.localStorage; }catch{ return { getItem(){ return null; }, setItem(){} }; }
}

function detectInitialLang(){
  let saved = null;
  try{ saved = localStorage.getItem("mcb_lang"); }catch{ /* archivio non disponibile */ }
  if(saved === "it" || saved === "en") return saved;
  return (navigator.language || "").toLowerCase().startsWith("it") ? "it" : "en";
}

const state = {
  provider: null,
  signer: null,
  address: null,
  chainId: null,
  contract: null,
  vehicles: [],
  currentTokenId: null,
  lang: detectInitialLang(),
  canUploadPhoto: false,
  membershipTier: 0,
  canUseCategories: false,
  canUploadDocument: false,
  logCache: null,
  hidden: null,
  showHidden: false,
};

function t(key, vars){
  let str = (I18N[state.lang] && I18N[state.lang][key]) || I18N.en[key] || key;
  if(vars){
    for(const k in vars){ str = str.replace(`{${k}}`, vars[k]); }
  }
  return str;
}

function localeCode(){
  return I18N[state.lang].localeCode;
}

function $(id){ return document.getElementById(id); }

function categoryLabelMap(){
  return {1:t("catMechanical"),2:t("catBodywork"),4:t("catTires"),8:t("catElectrical"),16:t("catCleaning"),32:t("catOther")};
}

function applyStaticTranslations(){
  document.documentElement.lang = state.lang;
  document.querySelectorAll("[data-i18n]").forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-ph]").forEach(el => {
    el.placeholder = t(el.dataset.i18nPh);
  });
  $("btn-lang").textContent = state.lang === "it" ? "EN" : "IT";
  $("i-desc-count").textContent = `${$("i-desc").value.length} / ${MAX_DESCRIPTION_LENGTH}`;
  if(!state.address){
    $("btn-connect").textContent = t("walletConnect");
  }
}

function renderDetailAttributes(v){
  const attrsEl = $("detail-attrs");
  attrsEl.textContent = "";
  for(const a of v.attributes){
    const pill = document.createElement("span");
    pill.className = "attr-pill";
    pill.textContent = `${translateAttributeKey(a.key)}: ${a.value}`;
    attrsEl.appendChild(pill);
  }
}

function setLang(lang){
  state.lang = lang;
  try{ localStorage.setItem("mcb_lang", lang); }catch{ /* ignora */ }
  applyStaticTranslations();
  if(state.vehicles && state.vehicles.length) renderVehicleList();
  if(state.currentTokenId){
    // Solo ridisegno dagli eventi già letti: nessuna nuova lettura della
    // catena al cambio lingua (audit MCB-14).
    const cached = state.logCache && state.logCache.cached(state.currentTokenId);
    if(cached) renderInterventions(cached);
    const v = state.vehicles.find(x => x.tokenId === state.currentTokenId);
    if(v) renderDetailAttributes(v);
  }
}

$("btn-lang").addEventListener("click", () => {
  setLang(state.lang === "it" ? "en" : "it");
});

function showToast(message, variant=false){
  const el = document.createElement("div");
  let cls = "toast";
  if(variant === true || variant === "error") cls += " error";
  else if(variant === "success") cls += " success";
  el.className = cls;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), variant === "success" ? 5000 : 4000);
}

function dateToTimestamp(dateInputValue){
  if(!dateInputValue) return 0;
  return Math.floor(new Date(dateInputValue + "T00:00:00Z").getTime() / 1000);
}

function timestampToStampParts(ts){
  const d = new Date(Number(ts) * 1000);
  return {
    day: String(d.getUTCDate()).padStart(2,"0"),
    month: d.toLocaleDateString(localeCode(), { month:"short" }).toUpperCase(),
    year: d.getUTCFullYear()
  };
}

function eurosToCents(value){
  if(value === "" || value === null || value === undefined) return 0;
  return Math.round(parseFloat(value) * 100);
}

function centsToEuroLabel(cents){
  const n = Number(cents);
  if(!n) return null;
  return (n / 100).toLocaleString(localeCode(), { style:"currency", currency:"EUR" });
}

function formatKm(km){
  return Number(km).toLocaleString(localeCode());
}

function navigate(view){
  ["list","mint","detail","intervention"].forEach(v => {
    $("view-" + v).hidden = (v !== view);
  });
  window.scrollTo(0,0);
}

document.querySelectorAll("[data-nav]").forEach(btn => {
  btn.addEventListener("click", () => navigate(btn.dataset.nav));
});

async function connectWallet(){
  const injected = window.lukso || window.ethereum;
  if(!injected){
    showToast(t("toastNoUp"), true);
    return;
  }

  try{
    state.provider = new ethers.BrowserProvider(injected);
    await injected.request({ method: "eth_requestAccounts" });
    state.signer = await state.provider.getSigner();
    state.address = await state.signer.getAddress();
    const network = await state.provider.getNetwork();
    state.chainId = Number(network.chainId);
    const netConfig = NETWORKS[state.chainId];
    if(!netConfig){
      showToast(t("toastNetworkUnsupported"), true);
      return;
    }
    if(netConfig.contractAddress === "0x0000000000000000000000000000000000000000"){
      showToast(t("toastNoContract"), true);
      return;
    }

    state.contract = new ethers.Contract(netConfig.contractAddress, MYCARBOOK_ABI, state.signer);
    state.hidden = createHiddenList(safeStorage(), state.address);
    state.logCache = createLogCache({
      getBlockNumber: () => state.provider.getBlockNumber(),
      queryRange: (tokenId, from, to) => state.contract.queryFilter(state.contract.filters.InterventionLogged(tokenId), from, to),
      startBlock: netConfig.deploymentBlock || 0
    });

    $("btn-connect").textContent = state.address.slice(0,6) + "…" + state.address.slice(-4);
    $("btn-connect").classList.add("connected");
    $("list-not-connected").hidden = true;
    $("btn-new-vehicle").hidden = false;

    await checkMembershipAccess();
    await loadVehicles();
  }catch(err){
    console.error(err);
    showToast(t("toastConnectFailed"), true);
  }
}

$("btn-connect").addEventListener("click", connectWallet);

// Tier membership (0 = nessuna) e permessi gerarchici: Bronze -> foto,
// Silver -> + categorie, Gold -> + documenti. È solo comodità di UI: i
// permessi veri per il pin sono verificati dal backend. La lista manuale
// (solo foto) non è più interrogabile per indirizzo: l'utente la verifica
// firmando con la propria UP (audit MCB-09).
async function checkMembershipAccess(){
  let tier = 0;
  try{
    const membershipAddress = MEMBERSHIP_ADDRESSES[state.chainId];
    if(membershipAddress && membershipAddress !== "0x0000000000000000000000000000000000000000"){
      const membershipContract = new ethers.Contract(membershipAddress, MEMBERSHIP_ABI, state.provider);
      tier = Number(await membershipContract.tierOf(state.address));
    }
  }catch(err){
    console.warn("Controllo membership non riuscito, la considero negativa:", err);
  }

  state.membershipTier = tier;
  state.canUploadPhoto = tier >= TIER_BRONZE;
  state.canUseCategories = tier >= TIER_SILVER;
  state.canUploadDocument = tier >= TIER_GOLD;
  applyAccessToForm();
}

function applyAccessToForm(){
  $("f-photo").disabled = !state.canUploadPhoto;
  $("photo-locked-hint").hidden = state.canUploadPhoto;
  $("btn-check-photo-access").hidden = state.canUploadPhoto;

  document.querySelectorAll(".i-category").forEach(el => el.disabled = !state.canUseCategories);
  $("category-locked-hint").hidden = state.canUseCategories;

  $("f-document").disabled = !state.canUploadDocument;
  $("document-locked-hint").hidden = state.canUploadDocument;
}

$("btn-check-photo-access").addEventListener("click", async () => {
  if(!state.address) return;
  try{
    const headers = await signUploadHeaders({
      signer: state.signer, address: state.address, chainId: state.chainId, purpose: "access", bytes: new Uint8Array(0)
    });
    const res = await fetch("/api/photo-access", { method: "POST", headers });
    const data = await res.json().catch(() => ({}));
    if(res.ok && data.allowed){
      state.canUploadPhoto = true;
      applyAccessToForm();
      showToast(t("toastPhotoAccessGranted"), "success");
    }else{
      showToast(t("toastPhotoAccessDenied"), true);
    }
  }catch(err){
    console.warn(err);
    showToast(t("toastPhotoAccessDenied"), true);
  }
});

// Ogni token è letto per conto suo: un token malformato (anche "spinto"
// da terzi nella UP) viene saltato invece di bloccare la lista (MCB-11).
async function loadVehicles(){
  let tokenIds;
  try{
    tokenIds = await state.contract.tokenIdsOf(state.address);
  }catch(err){
    console.error(err);
    showToast(t("toastLoadVehiclesError"), true);
    return;
  }

  const vehicles = [];
  for(const tokenId of tokenIds){
    try{
      const info = await state.contract.getVehicleInfo(tokenId);
      let meta = { name: null, attributes: [], icon: null };
      try{
        const metadataBytes = await state.contract.getDataForTokenId(tokenId, LSP4_METADATA_KEY);
        meta = await decodeVehicleMetadata(metadataBytes);
      }catch(e){
        console.warn("Metadata non leggibile per", tokenId, e);
      }
      vehicles.push({
        tokenId,
        name: meta.name || t("unnamedVehicle"),
        attributes: meta.attributes,
        icon: meta.icon,
        km: info.km,
        regDate: info.registrationDate,
        purchaseDate: info.purchaseDate,
      });
    }catch(err){
      console.warn("Veicolo non leggibile, lo salto:", tokenId, err);
    }
  }
  state.vehicles = vehicles;
  renderVehicleList();
}

async function decodeVehicleMetadata(metadataBytes){
  const decoded = ERC725.decodeData([{ keyName: "LSP4Metadata", value: metadataBytes }], LSP4_SCHEMA);
  const url = decoded && decoded[0] && decoded[0].value && decoded[0].value.url;
  const urls = gatewayUrls(url);
  if(urls.length === 0) throw new Error("link metadata non valido");
  const json = await fetchJsonWithFallback(urls);
  return sanitizeVehicleMetadata(json);
}

async function fetchJsonWithFallback(urls){
  let lastError;
  for(const url of urls){
    try{
      const res = await fetch(url);
      if(!res.ok) throw new Error(`Gateway ha risposto ${res.status}`);
      return await res.json();
    }catch(err){
      console.warn("Gateway IPFS non disponibile, provo il successivo:", url, err);
      lastError = err;
    }
  }
  throw lastError;
}

function renderVehicleList(){
  const container = $("vehicle-list");
  container.textContent = "";

  const visible = state.vehicles.filter(v => state.showHidden || !state.hidden || !state.hidden.has(v.tokenId));
  $("list-empty").hidden = visible.length !== 0;

  for(const v of visible){
    container.appendChild(createVehicleCard(document, v, {
      kmText: `${formatKm(v.km)} km`,
      onOpen: () => openVehicleDetail(v.tokenId)
    }));
  }

  const hiddenCount = state.hidden ? state.vehicles.filter(v => state.hidden.has(v.tokenId)).length : 0;
  const btn = $("btn-show-hidden");
  btn.hidden = hiddenCount === 0 || state.showHidden;
  btn.textContent = t("showHiddenBtn", { n: hiddenCount });
}

$("btn-show-hidden").addEventListener("click", () => {
  state.showHidden = true;
  renderVehicleList();
});

// Le attributes (Brand/Model/Trim/Plate/VIN) sono salvate on-chain in
// inglese, sempre — solo la UI le traduce a video in base alla lingua
// attiva. Chiavi non riconosciute restano mostrate così come sono salvate.
function translateAttributeKey(key){
  const map = {
    Brand: "labelBrand",
    Model: "labelModel",
    Trim: "labelTrim",
    Plate: "labelPlate",
    VIN: "labelVin"
  };
  return map[key] ? t(map[key]) : key;
}

// Estrae un motivo leggibile da un errore ethers (revert del contratto,
// gas insufficiente, rete, ecc.).
function extractErrorReason(err){
  const raw = err?.reason || err?.shortMessage || err?.info?.error?.message || err?.message || "";
  return String(raw)
    .replace(/^execution reverted:?\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .split("(")[0]
    .trim()
    .slice(0, 120);
}

$("btn-new-vehicle").addEventListener("click", () => navigate("mint"));

// Presa d'atto targa/VIN visibile solo quando uno dei due è compilato.
function updateIdentityAckVisibility(){
  const needed = needsIdentityAck({ plate: $("f-plate").value, vin: $("f-vin").value });
  $("identity-ack-row").hidden = !needed;
  if(!needed) $("i-identity-privacy-ack").checked = false;
}
$("f-plate").addEventListener("input", updateIdentityAckVisibility);
$("f-vin").addEventListener("input", updateIdentityAckVisibility);

$("btn-mint-review").addEventListener("click", () => {
  const name = $("f-name").value.trim();
  const brand = $("f-brand").value.trim();
  const model = $("f-model").value.trim();
  const trim = $("f-trim").value.trim();
  const plate = $("f-plate").value.trim();
  const vin = $("f-vin").value.trim();
  const regDate = $("f-reg-date").value;
  const purchaseDate = $("f-purchase-date").value;
  const km = $("f-km").value.trim();

  if(![brand, model, trim, plate, vin].some(v => v.length > 0)){
    showToast(t("toastFillOneField"), true);
    return;
  }
  const lengthError = validateAttributeLengths({ name, brand, model, trim, plate, vin });
  if(lengthError){
    showToast(t(lengthError), true);
    return;
  }
  if(needsIdentityAck({ plate, vin }) && !$("i-identity-privacy-ack").checked){
    showToast(t("toastIdentityAckRequired"), true);
    return;
  }
  if(!regDate || !purchaseDate){
    showToast(t("toastDatesRequired"), true);
    return;
  }

  const photoFile = $("f-photo").files[0];
  if(photoFile && !$("i-photo-privacy-ack").checked){
    showToast(t("toastPhotoAckRequired"), true);
    return;
  }
  const kmError = validateKm(km);
  if(kmError){
    showToast(t(kmError), true);
    return;
  }

  const box = $("mint-confirm");
  box.hidden = false;
  setHtml(box, html`
    <h3>${t("confirmTitle")}</h3>
    <div class="confirm-row"><span class="k">${t("rowName")}</span><span>${name || "—"}</span></div>
    <div class="confirm-row"><span class="k">${t("rowBrandModel")}</span><span>${brand} ${model}</span></div>
    <div class="confirm-row"><span class="k">${t("rowTrim")}</span><span>${trim || "—"}</span></div>
    <div class="confirm-row"><span class="k">${t("rowPlate")}</span><span>${plate || "—"}</span></div>
    <div class="confirm-row"><span class="k">${t("rowVin")}</span><span>${vin || "—"}</span></div>
    <div class="confirm-row"><span class="k">${t("rowRegDate")}</span><span>${regDate}</span></div>
    <div class="confirm-row"><span class="k">${t("rowPurchaseDate")}</span><span>${purchaseDate}</span></div>
    <div class="confirm-row"><span class="k">${t("rowKm")}</span><span>${formatKm(km)}</span></div>
  `);

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "btn btn-primary";
  confirmBtn.textContent = t("confirmSignBtn");
  confirmBtn.addEventListener("click", (e) => submitMint({ name, brand, model, trim, plate, vin, regDate, purchaseDate, km }, e.currentTarget));
  box.appendChild(confirmBtn);

  box.scrollIntoView({ behavior: "smooth" });
});

async function submitMint(data, confirmBtn){
  const originalBtnText = confirmBtn ? confirmBtn.textContent : null;
  if(confirmBtn){
    confirmBtn.disabled = true;
    confirmBtn.textContent = t("toastTxSent");
  }

  try{
    const attributes = [];
    if(data.brand) attributes.push({ key:"Brand", value:data.brand, type:"string" });
    if(data.model) attributes.push({ key:"Model", value:data.model, type:"string" });
    if(data.trim) attributes.push({ key:"Trim", value:data.trim, type:"string" });
    if(data.plate) attributes.push({ key:"Plate", value:data.plate, type:"string" });
    if(data.vin) attributes.push({ key:"VIN", value:data.vin, type:"string" });

    const photo = await uploadVehiclePhotoIfProvided();

    const metadataJson = {
      LSP4Metadata: {
        name: (data.name || `${data.brand} ${data.model}`.trim() || t("defaultVehicleName")).slice(0, LIMITS.name),
        description: "On-chain maintenance logbook — MyCarBook.",
        links: [],
        icon: photo ? [photo] : [],
        images: photo ? [[photo]] : [],
        assets: [],
        attributes
      }
    };

    // Lo stesso testo viene firmato, pinnato e usato per il keccak256 del
    // VerifiableURI: tutto coerente byte per byte.
    const { cid } = await uploadJsonToIpfs(JSON.stringify(metadataJson), "metadata");

    const encoded = ERC725.encodeData([{
      keyName: "LSP4Metadata",
      value: { json: metadataJson, url: `ipfs://${cid}` }
    }], LSP4_SCHEMA);

    const tx = await state.contract.mintVehicle(
      dateToTimestamp(data.regDate),
      dateToTimestamp(data.purchaseDate),
      BigInt(data.km),
      encoded.values[0]
    );
    showToast(t("toastTxSent"));
    await tx.wait();
    showToast("✓ " + t("toastVehicleRegistered"), "success");

    clearMintForm();
    await loadVehicles();
    navigate("list");
  }catch(err){
    console.error(err);
    const reason = extractErrorReason(err);
    showToast(reason ? `${t("toastTxFailed")} (${reason})` : t("toastTxFailed"), true);
    if(confirmBtn){
      confirmBtn.disabled = false;
      confirmBtn.textContent = originalBtnText;
    }
  }
}

async function pinFile(bytes, type, purpose){
  const headers = await signUploadHeaders({
    signer: state.signer, address: state.address, chainId: state.chainId, purpose, bytes
  });
  const formData = new FormData();
  formData.append("file", new Blob([bytes], { type }), "upload");
  const res = await fetch("/api/pin-file", { method: "POST", headers, body: formData });
  if(!res.ok){
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || "upload fallito");
  }
  return (await res.json()).cid;
}

// Foto del veicolo: ricodificata nel browser (via EXIF/GPS), firmata e
// pinnata. Se l'upload fallisce il mint prosegue senza foto.
async function uploadVehiclePhotoIfProvided(){
  const fileInput = $("f-photo");
  if(!state.canUploadPhoto || !fileInput.files || fileInput.files.length === 0) return null;

  const file = fileInput.files[0];
  if(file.size > 20 * 1024 * 1024){
    showToast(t("toastPhotoTooBig"), true);
    return null;
  }

  try{
    const image = await reencodeImage(file, { maxSide: 800 });
    if(image.bytes.length > 5 * 1024 * 1024){
      showToast(t("toastPhotoTooBig"), true);
      return null;
    }
    const cid = await pinFile(image.bytes, image.type, "photo");
    return {
      width: image.width,
      height: image.height,
      url: `ipfs://${cid}`,
      verification: { method: "keccak256(bytes)", data: ethers.keccak256(image.bytes) }
    };
  }catch(err){
    console.warn("Upload foto non riuscito:", err);
    showToast(t("toastPhotoUploadFailed"), true);
    return null;
  }
}

// Documento allegato all'intervento (fattura, ecc.) — solo comodità: il
// link viene agganciato in coda alla description con un marcatore
// [doc:ipfs://CID] che la UI riconosce in lettura.
async function uploadDocumentIfProvided(){
  const fileInput = $("f-document");
  if(!state.canUploadDocument || !fileInput.files || fileInput.files.length === 0) return null;

  const file = fileInput.files[0];
  if(file.size > 5 * 1024 * 1024){
    throw new Error(t("toastPhotoTooBig"));
  }
  let bytes, type;
  if(file.type === "application/pdf"){
    bytes = new Uint8Array(await file.arrayBuffer());
    type = "application/pdf";
  }else{
    const image = await reencodeImage(file, { maxSide: 2400 });
    bytes = image.bytes;
    type = image.type;
  }
  const cid = await pinFile(bytes, type, "document");
  return `ipfs://${cid}`;
}

function clearMintForm(){
  ["f-name","f-brand","f-model","f-trim","f-plate","f-vin","f-reg-date","f-purchase-date","f-km"]
    .forEach(id => $(id).value = "");
  $("f-photo").value = "";
  $("i-photo-privacy-ack").checked = false;
  updateIdentityAckVisibility();
  $("mint-confirm").hidden = true;
}

async function uploadJsonToIpfs(jsonText, purpose){
  const bytes = new TextEncoder().encode(jsonText);
  const headers = await signUploadHeaders({
    signer: state.signer, address: state.address, chainId: state.chainId, purpose, bytes
  });
  const res = await fetch("/api/pin-json", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: bytes
  });
  if(!res.ok){
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || "IPFS pin error.");
  }
  const data = await res.json();
  return { cid: data.cid };
}

async function openVehicleDetail(tokenId){
  state.currentTokenId = tokenId;
  const v = state.vehicles.find(x => x.tokenId === tokenId);
  if(!v) return;

  $("detail-name").textContent = v.name;
  $("detail-km").textContent = formatKm(v.km);

  const oldPhoto = $("detail-photo");
  // elemento nuovo ad ogni apertura: nessun gestore di errore residuo
  const photoEl = oldPhoto.cloneNode(false);
  oldPhoto.replaceWith(photoEl);
  photoEl.hidden = !(v.icon && setImageWithFallback(photoEl, v.icon));
  if(photoEl.hidden) photoEl.removeAttribute("src");

  renderDetailAttributes(v);
  $("transfer-box").hidden = true;

  navigate("detail");
  await loadInterventions(tokenId);
}

$("btn-hide-vehicle").addEventListener("click", () => {
  if(!state.currentTokenId || !state.hidden) return;
  state.hidden.hide(state.currentTokenId);
  state.showHidden = false;
  showToast(t("toastVehicleHidden"), "success");
  renderVehicleList();
  navigate("list");
});

$("btn-transfer").addEventListener("click", () => {
  $("transfer-box").hidden = false;
  $("f-transfer-to").focus();
});

$("btn-transfer-confirm").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  const to = $("f-transfer-to").value.trim();
  const error = validateTransferTarget({
    to, from: state.address, contractAddress: NETWORKS[state.chainId].contractAddress, isAddress: ethers.isAddress
  });
  if(error){
    showToast(t(error), true);
    return;
  }
  btn.disabled = true;
  try{
    // force=false: il destinatario deve essere una Universal Profile (o un
    // contratto che dichiara di accettare token LSP8), non un indirizzo a caso.
    const tx = await state.contract.transfer(state.address, ethers.getAddress(to), state.currentTokenId, false, "0x");
    showToast(t("toastTxSent"));
    await tx.wait();
    showToast("✓ " + t("toastTransferDone"), "success");
    $("f-transfer-to").value = "";
    state.currentTokenId = null;
    await loadVehicles();
    navigate("list");
  }catch(err){
    console.error(err);
    const reason = extractErrorReason(err);
    showToast(reason ? `${t("toastTxFailed")} (${reason})` : t("toastTxFailed"), true);
  }finally{
    btn.disabled = false;
  }
});

// Calcola e mostra un piccolo pannello statistiche a partire dagli stessi
// eventi già letti per la timeline — nessuna chiamata extra alla chain.
// Un intervento con più categorie viene contato per intero in ognuna.
function renderStats(events){
  const container = $("vehicle-stats");
  if(events.length === 0){
    container.textContent = "";
    return;
  }

  const categoryLabels = categoryLabelMap();
  const currentYear = new Date().getFullYear();

  let totalSpendCents = 0;
  let countWithAmount = 0;
  const spendByYear = {};
  const spendByCategory = {};

  for(const ev of events){
    const cents = Number(ev.amountCents);
    const year = new Date(Number(ev.date) * 1000).getUTCFullYear();

    if(cents > 0){
      totalSpendCents += cents;
      countWithAmount++;
      spendByYear[year] = (spendByYear[year] || 0) + cents;
    }

    const flags = Number(ev.categoryFlags) || 0;
    for(const flag of Object.keys(categoryLabels)){
      if(flags & Number(flag)){
        spendByCategory[flag] = (spendByCategory[flag] || 0) + cents;
      }
    }
  }

  const thisYearSpendCents = spendByYear[currentYear] || 0;
  const avgCents = countWithAmount > 0 ? Math.round(totalSpendCents / countWithAmount) : 0;

  const yearsSorted = Object.keys(spendByYear).sort((a,b) => b - a);
  const yearRows = yearsSorted.length
    ? yearsSorted.map(y => html`
        <div class="stats-row">
          <span class="stats-k">${y}</span>
          <span class="stats-v">${centsToEuroLabel(spendByYear[y])}</span>
        </div>
      `)
    : html`<p class="stats-empty">${t("statsNoSpendData")}</p>`;

  const categoriesWithSpend = Object.keys(spendByCategory).filter(f => spendByCategory[f] > 0);
  const categoryRows = categoriesWithSpend.length
    ? categoriesWithSpend
        .sort((a,b) => spendByCategory[b] - spendByCategory[a])
        .map(f => html`
          <div class="stats-row">
            <span class="stats-k">${categoryLabels[f]}</span>
            <span class="stats-v">${centsToEuroLabel(spendByCategory[f])}</span>
          </div>
        `)
    : html`<p class="stats-empty">${t("statsNoCategoryData")}</p>`;

  setHtml(container, html`
    <div class="stats-card">
      <h3>${t("statsTitle")}</h3>

      <div class="stats-section">
        <div class="stats-row">
          <span class="stats-k">${t("statsTotalInterventions")}</span>
          <span class="stats-v">${events.length}</span>
        </div>
        <div class="stats-row">
          <span class="stats-k">${t("statsTotalSpend")}</span>
          <span class="stats-v highlight">${totalSpendCents > 0 ? centsToEuroLabel(totalSpendCents) : "—"}</span>
        </div>
        <div class="stats-row">
          <span class="stats-k">${t("statsThisYearSpend", { year: currentYear })}</span>
          <span class="stats-v">${thisYearSpendCents > 0 ? centsToEuroLabel(thisYearSpendCents) : "—"}</span>
        </div>
        <div class="stats-row">
          <span class="stats-k">${t("statsAvgCost")}</span>
          <span class="stats-v">${avgCents > 0 ? centsToEuroLabel(avgCents) : "—"}</span>
        </div>
        ${countWithAmount < events.length ? html`<p class="stats-empty">${t("statsAmountSpecifiedFor", { n: countWithAmount, total: events.length })}</p>` : ""}
      </div>

      <div class="stats-section">
        <div class="stats-section-label">${t("statsSpendByYear")}</div>
        ${yearRows}
      </div>

      <div class="stats-section">
        <div class="stats-section-label">${t("statsSpendByCategory")}</div>
        ${categoryRows}
      </div>
    </div>
  `);
}

function renderInterventions(events){
  const timeline = $("intervention-timeline");
  timeline.textContent = "";

  const sorted = events
    .map(e => e.args)
    .sort((a,b) => Number(b.date) - Number(a.date));

  $("timeline-empty").hidden = sorted.length !== 0;
  renderStats(sorted);

  const categoryLabels = categoryLabelMap();
  for(const ev of sorted){
    const stamp = timestampToStampParts(ev.date);
    timeline.appendChild(createTimelineEntry(document, ev, {
      day: stamp.day,
      month: stamp.month,
      yearShort: String(stamp.year).slice(-2),
      kmText: `${formatKm(ev.km)} km`,
      amountLabel: centsToEuroLabel(ev.amountCents),
      categoryLabels: Object.keys(categoryLabels).filter(v => Number(ev.categoryFlags) & Number(v)).map(v => categoryLabels[v]),
      viewDocumentLabel: t("viewDocument")
    }));
  }
}

async function loadInterventions(tokenId){
  const cached = state.logCache.cached(tokenId);
  if(cached) renderInterventions(cached);
  else{
    $("intervention-timeline").textContent = "";
    $("vehicle-stats").textContent = "";
  }
  try{
    const events = await state.logCache.refresh(tokenId);
    if(state.currentTokenId === tokenId) renderInterventions(events);
  }catch(err){
    console.error(err);
    showToast(t("toastLoadHistoryError"), true);
  }
}

$("btn-new-intervention").addEventListener("click", () => {
  navigate("intervention");
});

$("i-desc").addEventListener("input", () => {
  $("i-desc-count").textContent = `${$("i-desc").value.length} / ${MAX_DESCRIPTION_LENGTH}`;
});

$("btn-intervention-review").addEventListener("click", () => {
  const date = $("i-date").value;
  const km = $("i-km").value.trim();
  const amount = $("i-amount").value;
  const desc = $("i-desc").value.trim();

  if(!date){
    showToast(t("toastDateRequired"), true);
    return;
  }
  if(km === ""){
    showToast(t("toastKmRequiredIntervention"), true);
    return;
  }
  const kmError = validateKm(km);
  if(kmError){
    showToast(t(kmError), true);
    return;
  }
  if(desc.length === 0){
    showToast(t("toastDescRequired"), true);
    return;
  }
  if(new TextEncoder().encode(desc).length > MAX_DESCRIPTION_LENGTH){
    showToast(t("toastDescTooLong", { max: MAX_DESCRIPTION_LENGTH }), true);
    return;
  }

  const documentFile = $("f-document").files[0];
  if(documentFile && !$("i-document-privacy-ack").checked){
    showToast(t("toastDocumentAckRequired"), true);
    return;
  }

  const categoryFlags = state.canUseCategories
    ? Array.from(document.querySelectorAll(".i-category:checked")).reduce((sum, el) => sum + Number(el.value), 0)
    : 0;
  const categoryLabels = categoryLabelMap();
  const selectedCategoryNames = Object.keys(categoryLabels)
    .filter(v => categoryFlags & Number(v))
    .map(v => categoryLabels[v]);

  const v = state.vehicles.find(x => x.tokenId === state.currentTokenId);
  const bigJump = v && kmJumpCheck(km, v.km) === "confirm";

  const box = $("intervention-confirm");
  box.hidden = false;
  setHtml(box, html`
    <h3>${t("confirmTitle")}</h3>
    <div class="confirm-row"><span class="k">${t("rowDate")}</span><span>${date}</span></div>
    <div class="confirm-row"><span class="k">${t("rowKmIntervention")}</span><span>${formatKm(km)}</span></div>
    <div class="confirm-row"><span class="k">${t("rowAmount")}</span><span>${amount ? centsToEuroLabel(eurosToCents(amount)) : t("amountNotSpecified")}</span></div>
    <div class="confirm-row"><span class="k">${t("rowDesc")}</span><span>${desc}</span></div>
    ${selectedCategoryNames.length ? html`<div class="confirm-row"><span class="k">${t("rowCategories")}</span><span>${selectedCategoryNames.join(", ")}</span></div>` : ""}
    ${documentFile ? html`<div class="confirm-row"><span class="k">${t("rowDocument")}</span><span>${documentFile.name}</span></div>` : ""}
    ${bigJump ? html`<div class="warn-box">${t("kmJumpWarning", { diff: formatKm(Number(km) - Number(v.km)) })}
      <label class="ack-label"><input type="checkbox" id="i-km-jump-ack" /> <span>${t("ackKmJump")}</span></label></div>` : ""}
  `);

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "btn btn-primary";
  confirmBtn.textContent = t("confirmSignBtn");
  confirmBtn.addEventListener("click", (e) => {
    if(bigJump && !$("i-km-jump-ack").checked){
      showToast(t("toastKmJumpAckRequired"), true);
      return;
    }
    submitIntervention({ date, km, amount, desc, categoryFlags }, e.currentTarget);
  });
  box.appendChild(confirmBtn);

  box.scrollIntoView({ behavior:"smooth" });
});

async function submitIntervention(data, confirmBtn){
  const originalBtnText = confirmBtn ? confirmBtn.textContent : null;
  if(confirmBtn){
    confirmBtn.disabled = true;
    confirmBtn.textContent = t("toastTxSent");
  }
  const restore = () => {
    if(confirmBtn){ confirmBtn.disabled = false; confirmBtn.textContent = originalBtnText; }
  };

  let documentUri = null;
  try{
    documentUri = await uploadDocumentIfProvided();
  }catch(err){
    console.warn("Upload documento non riuscito:", err);
    showToast(t("toastDocumentUploadFailed"), true);
    restore();
    return;
  }

  try{
    let finalDesc = data.desc;
    if(documentUri){
      const marker = ` [doc:${documentUri}]`;
      if(new TextEncoder().encode(finalDesc + marker).length > MAX_DESCRIPTION_LENGTH){
        showToast(t("toastDescTooLongWithDoc"), true);
        restore();
        return;
      }
      finalDesc = finalDesc + marker;
    }

    const tx = await state.contract.logIntervention(
      state.currentTokenId,
      dateToTimestamp(data.date),
      BigInt(data.km),
      Number(data.categoryFlags) || 0,
      BigInt(eurosToCents(data.amount)),
      finalDesc
    );
    showToast(t("toastTxSent"));
    await tx.wait();
    showToast("✓ " + t("toastInterventionRegistered"), "success");

    clearInterventionForm();
    navigate("detail");
    await loadInterventions(state.currentTokenId);

    const v = state.vehicles.find(x => x.tokenId === state.currentTokenId);
    if(v && Number(data.km) > Number(v.km)){
      v.km = data.km;
      $("detail-km").textContent = formatKm(v.km);
    }
  }catch(err){
    console.error(err);
    const reason = extractErrorReason(err);
    showToast(reason ? `${t("toastTxFailed")} (${reason})` : t("toastTxFailed"), true);
    restore();
  }
}

function clearInterventionForm(){
  ["i-date","i-km","i-amount","i-desc"].forEach(id => $(id).value = "");
  document.querySelectorAll(".i-category").forEach(el => el.checked = false);
  $("f-document").value = "";
  $("i-document-privacy-ack").checked = false;
  $("i-desc-count").textContent = `0 / ${MAX_DESCRIPTION_LENGTH}`;
  $("intervention-confirm").hidden = true;
}

applyStaticTranslations();
navigate("list");
