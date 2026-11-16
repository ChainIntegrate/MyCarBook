// Costruzione del DOM per i dati che arrivano da catena e IPFS (scritti da
// chiunque): solo createElement + textContent / proprietà, mai HTML
// composto a stringhe (audit MCB-01).
import { gatewayUrls, parseDocMarker } from "./ipfs.js";

/** Imposta src dal gateway proprio, con ripiego sul secondo in caso di errore. */
export function setImageWithFallback(img, uri) {
  const urls = gatewayUrls(uri);
  if (urls.length === 0) return false;
  let i = 0;
  img.src = urls[0];
  img.addEventListener("error", function onError() {
    i++;
    if (i < urls.length) img.src = urls[i];
    else img.removeEventListener("error", onError);
  });
  return true;
}

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

/**
 * @param {Document} doc
 * @param {{name:string, icon:string|null}} vehicle
 * @param {{kmText:string, onOpen:Function}} opts
 */
export function createVehicleCard(doc, vehicle, { kmText, onOpen }) {
  const card = el(doc, "div", "vehicle-card");
  const thumb = el(doc, "div", "vehicle-thumb");
  let hasImage = false;
  if (vehicle.icon) {
    const img = el(doc, "img", "vehicle-thumb-img");
    img.alt = "";
    hasImage = setImageWithFallback(img, vehicle.icon);
    if (hasImage) thumb.appendChild(img);
  }
  if (!hasImage) thumb.textContent = "🚗";

  const body = el(doc, "div", "vehicle-card-body");
  body.appendChild(el(doc, "div", "vehicle-card-name", vehicle.name));
  body.appendChild(el(doc, "div", "vehicle-card-meta", kmText));
  card.append(thumb, body);
  if (onOpen) card.addEventListener("click", onOpen);
  return card;
}

/**
 * @param {Document} doc
 * @param {object} ev  evento InterventionLogged (description, ...)
 * @param {{day:string, month:string, yearShort:string, kmText:string, amountLabel:string|null, categoryLabels:string[], viewDocumentLabel:string}} view
 */
export function createTimelineEntry(doc, ev, view) {
  const { text, docUri } = parseDocMarker(ev.description);

  const entry = el(doc, "div", "stamp-entry");
  const badge = el(doc, "div", "stamp-badge");
  const d = el(doc, "div", "d");
  d.append(doc.createTextNode(view.day), doc.createElement("br"), doc.createTextNode(`${view.month} '${view.yearShort}`));
  badge.appendChild(d);

  const card = el(doc, "div", "stamp-card");
  card.appendChild(el(doc, "div", "desc", text));
  if (view.categoryLabels.length) {
    const tags = el(doc, "div", "category-tags");
    for (const label of view.categoryLabels) tags.appendChild(el(doc, "span", "attr-pill", label));
    card.appendChild(tags);
  }
  const meta = el(doc, "div", "meta");
  meta.appendChild(el(doc, "span", null, view.kmText));
  if (view.amountLabel) meta.appendChild(el(doc, "span", null, view.amountLabel));
  if (docUri) {
    const a = el(doc, "a", "doc-link", `📎 ${view.viewDocumentLabel}`);
    a.href = gatewayUrls(docUri)[0];
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    meta.appendChild(a);
  }
  card.appendChild(meta);
  entry.append(badge, card);
  return entry;
}
