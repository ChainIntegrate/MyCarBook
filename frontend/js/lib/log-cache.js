// Storico interventi: lettura incrementale con memoria per sessione
// (audit MCB-14). La prima apertura legge dal blocco di deploy; le
// successive (cambio lingua, nuovo intervento) solo i blocchi nuovi, o
// nessuno se si tratta solo di ridisegnare.

export const MAX_BLOCK_RANGE = 9000;

/**
 * @param {{getBlockNumber:()=>Promise<number>, queryRange:(tokenId, from, to)=>Promise<any[]>, startBlock:number, sleep?:Function}} deps
 */
export function createLogCache({ getBlockNumber, queryRange, startBlock, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const cache = new Map(); // tokenId -> { events, lastBlock }

  async function queryWithRetry(tokenId, from, to) {
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await queryRange(tokenId, from, to);
      } catch (err) {
        lastErr = err;
        await sleep(800 * (attempt + 1));
      }
    }
    throw lastErr;
  }

  return {
    cached(tokenId) {
      const entry = cache.get(String(tokenId));
      return entry ? entry.events.slice() : null;
    },
    async refresh(tokenId) {
      const key = String(tokenId);
      const entry = cache.get(key) || { events: [], lastBlock: startBlock - 1 };
      const latest = await getBlockNumber();
      let start = entry.lastBlock + 1;
      const fresh = [];
      while (start <= latest) {
        const end = Math.min(start + MAX_BLOCK_RANGE - 1, latest);
        fresh.push(...(await queryWithRetry(tokenId, start, end)));
        start = end + 1;
      }
      const next = { events: entry.events.concat(fresh), lastBlock: Math.max(entry.lastBlock, latest) };
      cache.set(key, next);
      return next.events.slice();
    },
    clear() { cache.clear(); }
  };
}
