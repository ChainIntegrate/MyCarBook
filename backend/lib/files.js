"use strict";
// Controllo del contenuto reale dei file caricati (audit MCB-10, MCB-06).
// Il tipo dichiarato dal client NON conta: si guardano i primi byte.
// Le foto devono arrivare già ripulite dai metadati (il frontend le
// ricodifica con un <canvas>): un'immagine con EXIF/XMP viene rifiutata.

function detectFileType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  if (buf.toString("latin1", 0, 5) === "%PDF-") return "application/pdf";
  return null;
}

// JPEG: segmenti APP1 (Exif / XMP), APP13 (IPTC/Photoshop), COM (commento).
function jpegHasMetadata(buf) {
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return true; // struttura inattesa: rifiuto per prudenza
    const marker = buf[i + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
    if (marker === 0xda || marker === 0xd9) return false; // inizio dati immagine
    const len = buf.readUInt16BE(i + 2);
    if (marker === 0xe1 || marker === 0xed || marker === 0xfe) return true;
    i += 2 + len;
  }
  return false;
}

// PNG: chunk eXIf, tEXt, zTXt, iTXt, tIME.
function pngHasMetadata(buf) {
  let i = 8;
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString("latin1", i + 4, i + 8);
    if (["eXIf", "tEXt", "zTXt", "iTXt", "tIME"].includes(type)) return true;
    if (type === "IEND") return false;
    i += 12 + len;
  }
  return false;
}

// WebP: chunk EXIF e XMP .
function webpHasMetadata(buf) {
  let i = 12;
  while (i + 8 <= buf.length) {
    const type = buf.toString("latin1", i, i + 4);
    const len = buf.readUInt32LE(i + 4);
    if (type === "EXIF" || type === "XMP ") return true;
    i += 8 + len + (len % 2);
  }
  return false;
}

function imageHasMetadata(buf, type) {
  if (type === "image/jpeg") return jpegHasMetadata(buf);
  if (type === "image/png") return pngHasMetadata(buf);
  if (type === "image/webp") return webpHasMetadata(buf);
  return false;
}

const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

/**
 * @returns {{ok:true,type:string,filename:string}|{ok:false,error:string}}
 */
function checkUpload(buf, purpose) {
  const type = detectFileType(buf);
  const allowed = purpose === "document"
    ? ["image/jpeg", "image/png", "image/webp", "application/pdf"]
    : ["image/jpeg", "image/png", "image/webp"];
  if (!type || !allowed.includes(type)) {
    return { ok: false, error: purpose === "document" ? "Il file deve essere JPEG, PNG, WebP o PDF." : "Il file deve essere JPEG, PNG o WebP." };
  }
  if (type !== "application/pdf" && imageHasMetadata(buf, type)) {
    return { ok: false, error: "L'immagine contiene metadati (EXIF/posizione): ricaricala dall'app, che li rimuove." };
  }
  return { ok: true, type, filename: `mycarbook-${purpose}.${EXT[type]}` };
}

module.exports = { detectFileType, imageHasMetadata, checkUpload };
