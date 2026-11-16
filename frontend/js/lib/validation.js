// Controlli sui dati inseriti prima di firmare (audit MCB-12, MCB-05).
// Il contratto accetta qualunque km: un errore di battitura (1.000.000 al
// posto di 100.000) resterebbe per sempre come km massimo del veicolo.

export const MAX_KM = 2_000_000;
export const KM_JUMP_CONFIRM = 100_000;
export const LIMITS = { name: 100, attribute: 64, description: 280 };

/** @returns {string|null} chiave i18n dell'errore */
export function validateKm(raw) {
  if (raw === "" || raw === null || raw === undefined) return "toastKmRequired";
  if (!/^\d+$/.test(String(raw).trim())) return "toastKmInvalid";
  const km = Number(raw);
  if (!Number.isSafeInteger(km) || km > MAX_KM) return "toastKmTooHigh";
  return null;
}

/**
 * Salto di km rispetto al massimo già registrato.
 * @returns {"ok"|"confirm"} "confirm" se il salto è grande: l'utente deve
 *   confermarlo esplicitamente, perché non potrà più correggerlo.
 */
export function kmJumpCheck(newKm, currentMaxKm) {
  return Number(newKm) - Number(currentMaxKm) > KM_JUMP_CONFIRM ? "confirm" : "ok";
}

/** Targa o VIN compilati => serve la presa d'atto che saranno pubblici. */
export function needsIdentityAck({ plate, vin }) {
  return Boolean((plate && plate.trim()) || (vin && vin.trim()));
}

export function validateAttributeLengths({ name, brand, model, trim, plate, vin }) {
  if ((name || "").length > LIMITS.name) return "toastFieldTooLong";
  for (const v of [brand, model, trim, plate, vin]) {
    if ((v || "").length > LIMITS.attribute) return "toastFieldTooLong";
  }
  return null;
}

// Trasferimento: destinatario valido, diverso da sé e dal contratto.
export function validateTransferTarget({ to, from, contractAddress, isAddress }) {
  if (!to || !isAddress(to)) return "toastTransferInvalidAddress";
  const lower = to.toLowerCase();
  if (lower === String(from).toLowerCase()) return "toastTransferSelf";
  if (lower === String(contractAddress).toLowerCase() || /^0x0{40}$/.test(lower)) return "toastTransferInvalidAddress";
  return null;
}
