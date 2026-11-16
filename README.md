# MyCarBook

Storico manutenzioni veicolo on-chain su LUKSO. Mint libero (ogni utente
minta il proprio veicolo), nessuna cifratura (dato pubblico per natura della
chain — coerente con l'uso in fase di rivendita).

**Live**: https://mycarbook.chainintegrate.it

## Struttura

```
mycarbook/
├── contracts/
│   ├── MyCarBook.sol      — v1, storico, non più in uso dal frontend
│   └── MyCarBookV2.sol    — v2, DEPLOYATO e IN USO su testnet e mainnet
├── scripts/
│   ├── deploy.js           — deploy v1
│   └── deploy-v2.js        — deploy v2
├── backend/
│   ├── server.js            — avvio; logica in lib/ (app, auth, file, schema)
│   ├── lib/                 — pin su nodo IPFS proprio con firma ERC-1271
│   │   legata al contenuto; raccolta CID e operazioni sui pin
│   ├── scripts/             — check-pins (controllo/ripin/orfani), backup CAR
│   ├── test/                — test negativi del backend (node --test)
│   ├── allowed-addresses.json — lista manuale indirizzi autorizzati alla
│   │   foto veicolo (NON committato, vive solo sul VPS — vedi .gitignore)
│   └── allowed-addresses.example.json
├── deploy/                — vhost Nginx + intestazioni di sicurezza (CSP), unità systemd
├── docs/                  — AUDIT.md (stato dei punti), OPERATIONS.md, PRIVACY.md
├── tests/                 — test frontend (jsdom) ed end-to-end (Chromium + Nginx)
└── frontend/
    ├── index.html            — UI pubblica, vanilla JS (js/app.js), mobile-first, i18n EN/IT
    ├── js/, css/             — codice e stili (nessuno script/stile inline: CSP)
    ├── vendor/, fonts/       — ethers, erc725.js e font serviti in locale (SHA256SUMS)
    ├── admin-collection.html — pannello admin (owner contratto): metadata
    │   di collezione + immagine per singolo tokenId
    └── config.js              — indirizzi contratto per rete + ABI
```

## Stato attuale

**MyCarBookV2 è il contratto in uso, deployato e verificato su entrambe le
reti**:
- Testnet (4201): `0xcf1e38bB8aB96B5b0100Af55dC7E7eF9D2e2DE60`
- Mainnet (42): `0x24e9cd569AC99B6DF47CA767508cF63105318195`

`MyCarBook.sol` (v1) resta nel repo per riferimento storico ma non è più
collegato al frontend.

### Funzionalità v2 rispetto al v1

- **Fix bug km**: `logIntervention` aggiorna `vehicleInfo.km` solo se il
  nuovo valore è maggiore del massimo registrato — un intervento retroattivo
  con km più basso non fa mai regredire il contachilometri mostrato.
- **`categoryFlags`** (bitmask `uint8`) su ogni intervento: categorie
  combinabili — `CATEGORY_MECHANICAL=1`, `CATEGORY_BODYWORK=2`,
  `CATEGORY_TIRES=4`, `CATEGORY_ELECTRICAL=8`, `CATEGORY_CLEANING=16`,
  `CATEGORY_OTHER=32`.
- **Allegato documento su intervento**: valutato con hash on-chain, poi
  **scartato** ("troppo certificato" per lo scopo del progetto). Soluzione
  adottata: solo comodità, nessun hash — il link IPFS viene agganciato in
  coda alla `description` con un marcatore `[doc:ipfs://...]`, riconosciuto
  e mostrato come link cliccabile dalla UI in lettura. Nessun campo dedicato
  nel contratto.

### Sicurezza upload gated + storage

> Aggiornato dopo l'audit del 4/11/2026: vedi [docs/AUDIT.md](docs/AUDIT.md).

Fino a poco fa, il controllo "chi può caricare foto/documento" era applicato
**solo lato UI** (bottone disabilitato) — l'endpoint `/api/pin-file` restava
comunque chiamabile direttamente da chiunque, bypassando completamente il
gate. Corretto: ora ogni chiamata a `/api/pin-file` richiede una **firma
ERC-1271** (stesso pattern già in uso su MatchPredictor v3) che il backend
verifica prima di autorizzare il pin:

1. Il frontend firma un messaggio con la UP connessa che contiene dominio,
   `purpose`, indirizzo, rete, **impronta SHA-256 del file/JSON**, nonce
   casuale e istante — un tap in più sulla UP, oltre alla transazione.
2. Il backend verifica la firma via `isValidSignature` (ERC-1271) sulla UP
   del chiamante: valida 5 minuti, **una sola volta**, solo per quel
   contenuto, solo su mainnet (chainId 42).
3. Solo dopo, controlla l'autorizzazione in base al `purpose`:
   - `metadata` (`/api/pin-json`, mint) → qualunque UP, JSON con schema rigido
   - `photo` → lista manuale **o** tier Bronze+
   - `document` → tier Gold
   - `admin` → UP owner (`ADMIN_UP_ADDRESS`) **e** firma della chiave
     controller precisa `ADMIN_SIGNER_ADDRESS` (da `.env`)

Anche `/api/pin-json` richiede ora la firma (prima era aperto a chiunque).
Il tipo dei file si ricava dai byte (JPEG/PNG/WebP, PDF solo per i
documenti); le foto devono arrivare senza EXIF (l'app le ricodifica).
Rate limit per IP reale (`trust proxy` loopback dietro Nginx).

**Storage**: da Pinata al [nodo IPFS personale](https://ipfs.chainintegrate.it)
(Kubo, VPS Contabo dedicata, `Gateway.NoFetch=true` — serve solo contenuti
pinnati da noi). L'API di pin (`:5001`) è raggiungibile solo dall'IP del VPS
di produzione (whitelist a livello di rete; supportata anche
`IPFS_API_AUTH`). Il contenuto pinnato in passato su Pinata **non** è sul
nodo proprio finché non viene ripinnato con `npm run repin` (MCB-17): fino
ad allora si legge dal gateway LUKSO di riserva.

### Feature gating a fasce, tramite ChainIntegrate Membership

Tre funzionalità della UI sono sbloccate in base al tier posseduto su
[ChainIntegrate Membership](https://github.com/ChainIntegrate/chainintegrate-membership)
(letto on-chain via `tierOf(address)`, nessuna sincronizzazione manuale) —
gerarchia crescente, ogni tier include i vantaggi di quelli sotto:

| Tier | Prezzo indicativo | Sblocca |
|---|---|---|
| Bronze | ~50 LYX | Foto veicolo al mint |
| Silver | ~200 LYX | + Categorie intervento (checkbox) |
| Gold | 500 LYX | + Documento allegato a un intervento |

I prezzi non sono applicati né verificati dal contratto (mint resta
`onlyOwner`, gestito a mano da Simone dopo ricezione pagamento fuori banda)
— sono solo una convenzione operativa, non scritti nel codice.

La **foto veicolo** ha anche una seconda via di sblocco, indipendente dalla
membership: presenza in `backend/allowed-addresses.json` (lista manuale,
storica, mantenuta per compatibilità).

### Mint automatico a pagamento (valutato, non implementato)

Si era considerato un mint/upgrade membership completamente self-service
(l'utente paga in LYX, il contratto minta/aggiorna da solo). Non fattibile
senza un nuovo deploy: le funzioni di mint/upgrade sono `onlyOwner`, e
`Ownable` non permette doppia titolarità — trasferire l'ownership a una
chiave operativa nel backend avrebbe tolto a Simone la possibilità di
gestire tutto a mano dalla propria UP. Deciso di **non** procedere:
gestione manuale confermata come via definitiva per ora.

- **Immagine per singolo tokenId dopo il mint**: gestita da
  `admin-collection.html` (sezione dedicata) — solo l'owner del contratto
  può farlo (`setDataForTokenId` è `onlyOwner`). La pagina fa merge col
  metadata esistente, ma il contratto permette all'owner di sostituire
  l'intera scheda di qualunque veicolo, e il proprietario del veicolo non
  può correggerla da solo (MCB-04, da risolvere col prossimo contratto).

- **Metadata di collezione** (icona/banner/descrizione, visibili su
  universaleverything.io a livello di collezione): stessa pagina
  `admin-collection.html`, sezione separata. Impostata su **entrambe** le
  reti.

- **Traduzioni**: sia i testi statici della UI sia le etichette degli
  `attributes` on-chain (Brand/Model/Trim/Plate/VIN, salvati sempre in
  inglese) vengono tradotte a video in base alla lingua attiva — la
  traduzione avviene solo in UI, il dato on-chain resta invariato.

- **Branding**: logo, favicon, banner — generati con AI esterna da Simone.

## Note di design (per riferimento futuro)

- Font: Oswald (display, header stampati), Inter (corpo), JetBrains Mono
  (km/date/importi — leggibilità dati tipo contachilometri).
- Palette: nero-petrolio + ottone (`--brass`) come accento unico, verde
  motore per stati positivi.
- Elemento firma: ogni intervento è renderizzato come un "timbro" di
  libretto (badge circolare tratteggiato con la data), coerente col nome
  del prodotto.
- `erc725.js` è un bundle ESM generato in locale (`frontend/vendor/`,
  `cd tests && npm run vendor`), non più da esm.sh: la CSP ammette solo
  codice servito dal sito.
- Owner del contratto (branding/metadata) e deployer (chi paga il gas) sono
  sempre indirizzi separati per disciplina, su entrambe le reti.

## Non ancora implementato (rimandato volontariamente)

- Mint/upgrade membership self-service a pagamento (vedi sopra — richiede
  nuovo deploy con ruoli separati, non ritenuto necessario per ora).
- Nessuna cifratura di alcun dato — scelta esplicita, coerente con l'uso
  in fase di rivendita (storico verificabile da un futuro acquirente).
## Test

```
cd backend && npm ci && npm test      # backend: firma, schema, file, rate limit, pin IPFS
cd tests && npm ci && npm test        # frontend (jsdom) + end-to-end (Chromium, Nginx reale)
```
