// Autorizzazione firmata per gli upload. Il formato deve restare identico a
// backend/lib/auth.js (un test lo verifica). La firma lega dominio, scopo,
// UP, rete, impronta SHA-256 del contenuto, nonce monouso e istante.

export const AUTH_DOMAIN = "mycarbook.chainintegrate.it";

export function buildAuthMessage({ domain, purpose, address, chainId, sha256, nonce, issuedAt }) {
  return [
    "MyCarBook upload authorization",
    `domain: ${domain}`,
    `purpose: ${purpose}`,
    `address: ${String(address).toLowerCase()}`,
    `chainId: ${chainId}`,
    `sha256: ${String(sha256).toLowerCase()}`,
    `nonce: ${nonce}`,
    `issuedAt: ${issuedAt}`
  ].join("\n");
}

function toHex(bytes) {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(bytes, cryptoImpl = globalThis.crypto) {
  return toHex(await cryptoImpl.subtle.digest("SHA-256", bytes));
}

export function randomNonce(cryptoImpl = globalThis.crypto) {
  return toHex(cryptoImpl.getRandomValues(new Uint8Array(16)));
}

/**
 * Firma con la UP e restituisce le intestazioni da inviare al backend.
 * @param {{signMessage:(msg:string)=>Promise<string>}} signer
 */
export async function signUploadHeaders({ signer, address, chainId, purpose, bytes, domain = AUTH_DOMAIN, now = Date.now() }) {
  const sha256 = await sha256Hex(bytes);
  const nonce = randomNonce();
  const message = buildAuthMessage({ domain, purpose, address, chainId, sha256, nonce, issuedAt: now });
  const signature = await signer.signMessage(message);
  return {
    "X-MCB-Address": address,
    "X-MCB-Signature": signature,
    "X-MCB-Chain-Id": String(chainId),
    "X-MCB-Purpose": purpose,
    "X-MCB-Nonce": nonce,
    "X-MCB-Issued-At": String(now),
    "X-MCB-Content-SHA256": sha256
  };
}
