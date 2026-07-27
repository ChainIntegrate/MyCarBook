# MyCarBook

Storico manutenzioni veicolo on-chain su LUKSO. Mint libero (ogni utente
minta il proprio veicolo), nessuna cifratura (dato pubblico per natura della
chain — coerente con l'uso in fase di rivendita).

## Struttura

```
mycarbook/
├── contracts/
│   └── MyCarBook.sol
└── frontend/
    ├── index.html      — UI unica, vanilla JS, mobile-first
    └── config.js        — indirizzi contratto per rete + ABI
```

## TODO prima del primo deploy (testnet)

Questi sono placeholder espliciti nel codice, da chiudere in ordine:

1. **Verificare i path di import in `MyCarBook.sol`** contro la versione
   installata di `@lukso/lsp8-contracts` / `@lukso/lsp4-contracts` nel
   Codespace — `npx hardhat compile` lo dice subito.
2. **Confermare `tokenIdsOf(address)`** esiste con questo nome esatto sulla
   versione di LSP8 in uso (enumerazione token per owner). Se il nome
   differisce, aggiornare sia il contratto (se serve un wrapper) sia l'ABI
   in `config.js`.
3. **Collegare `uploadJsonToIpfs()` in `index.html`** a Pinata — oggi lancia
   volutamente un errore per non far credere che il mint funzioni prima che
   sia collegato. Stesso pattern di pinning già in uso su Birra20Venti.
4. **Verificare l'URL del bundle browser di `erc725.js`** in `index.html`
   con un `curl` diretto prima di fidarsi (come da nota LSP4: un URL di
   pinning sbagliato dà errori poco chiari tipo "Unexpected token '<'").
5. **Deploy su testnet 4201**, poi aggiornare `contractAddress` in
   `config.js` per la chiave `4201`.
6. **Giro di verifica manuale**: 1 mint veicolo + 2-3 interventi, controllo
   su `universaleverything.io` che tokenId (formato Number), nome, e
   attributes appaiano come previsto.
7. Solo dopo il giro pulito: **deploy su mainnet 42**, aggiornare
   `contractAddress` per la chiave `42` in `config.js`.

## Note di design (per riferimento futuro)

- Font: Oswald (display, header stampati), Inter (corpo), JetBrains Mono
  (km/date/importi — leggibilità dati tipo contachilometri).
- Palette: nero-petrolio + ottone (`--brass`) come accento unico, verde
  motore per stati positivi.
- Elemento firma: ogni intervento è renderizzato come un "timbro" di
  libretto (badge circolare tratteggiato con la data), coerente col nome
  del prodotto.

## Non ancora implementato (rimandato volutamente)

- Upload icona/immagine veicolo dopo il mint (bottone dedicato, vedi
  discussione: opzionale, ≤800px, hash keccak256 lato client).
- Allegati/documenti (fatture, foto intervento) — feature v2, verosimilmente
  a pagamento, stesso pattern hash-on-chain + file su IPFS.
