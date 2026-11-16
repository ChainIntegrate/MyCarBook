// Veicoli nascosti dalla lista (audit MCB-11): chiunque può "spingere" un
// token nella UP di un altro; qui l'utente può toglierlo dalla vista.
// Preferenza solo locale, nel browser; il token resta sulla catena.

const KEY = "mcb_hidden_tokens";

function read(storage, address) {
  try {
    const all = JSON.parse(storage.getItem(KEY) || "{}");
    const list = all[String(address).toLowerCase()];
    return Array.isArray(list) ? list.map(String) : [];
  } catch {
    return [];
  }
}

function write(storage, address, list) {
  try {
    const all = JSON.parse(storage.getItem(KEY) || "{}");
    all[String(address).toLowerCase()] = list;
    storage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* archivio non disponibile: la preferenza vale solo per questa pagina */
  }
}

export function createHiddenList(storage, address) {
  let list = read(storage, address);
  return {
    has: (tokenId) => list.includes(String(tokenId)),
    hide(tokenId) { if (!list.includes(String(tokenId))) { list = list.concat(String(tokenId)); write(storage, address, list); } },
    unhideAll() { list = []; write(storage, address, list); },
    count: () => list.length
  };
}
