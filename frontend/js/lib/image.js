// Ricodifica di un'immagine nel browser prima dell'upload (audit MCB-06):
// disegnandola su un <canvas> e riesportandola si perdono EXIF, posizione
// GPS, modello e numero di serie della fotocamera, data di scatto.
// Il backend rifiuta comunque immagini che contengono ancora metadati.

export async function reencodeImage(file, { maxSide = 1600, type = "image/jpeg", quality = 0.9 } = {}) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff"; // trasparenze PNG su fondo bianco nel JPEG
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("ricodifica non riuscita"))), type, quality)
  );
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height, type };
}
