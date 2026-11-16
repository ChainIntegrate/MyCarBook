// HTML sicuro per costruzione (audit MCB-01).
// Ogni valore interpolato in html`...` viene sottoposto a escape, a meno che
// non sia a sua volta un frammento html`...`. setHtml() accetta SOLO
// frammenti prodotti così: una stringa qualsiasi non può finire in innerHTML.

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;", "=": "&#61;" };

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"'`=]/g, (c) => ESCAPES[c]);
}

class SafeHtml {
  constructor(text) { this.text = text; }
  toString() { return this.text; }
}

function render(value) {
  if (value instanceof SafeHtml) return value.text;
  if (Array.isArray(value)) return value.map(render).join("");
  if (value === null || value === undefined || value === false) return "";
  return escapeHtml(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += render(v) + strings[i + 1]; });
  return new SafeHtml(out);
}

export function setHtml(el, fragment) {
  if (!(fragment instanceof SafeHtml)) throw new TypeError("setHtml accetta solo frammenti html``");
  el.innerHTML = fragment.text;
}

export function isSafeHtml(v) { return v instanceof SafeHtml; }
