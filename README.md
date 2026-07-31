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
│   ├── server.js            — proxy Pinata (mai JWT nel browser) + gate foto
│   ├── allowed-addresses.json — lista manuale indirizzi autorizzati alla
│   │   foto veicolo (NON committato, vive solo sul VPS — vedi .gitignore)
│   └── allowed-addresses.example.json
└── frontend/
    ├── index.html            — UI pubblica, vanilla JS, mobile-first, i18n EN/IT
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
  può farlo, protezione reale on-chain (`setDataForTokenId` è `onlyOwner`).
  Fa merge col metadata esistente (non sovrascrive marca/modello/targa/VIN).

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
- `erc725.js` va importato come modulo ES via `esm.sh` (`import { ERC725 }
  from "https://esm.sh/@erc725/erc725.js@0.28.2"`) — il bundle CommonJS su
  jsDelivr non espone un global utilizzabile da `<script>` classico.
- Owner del contratto (branding/metadata) e deployer (chi paga il gas) sono
  sempre indirizzi separati per disciplina, su entrambe le reti.

## Non ancora implementato (rimandato volontariamente)

- Mint/upgrade membership self-service a pagamento (vedi sopra — richiede
  nuovo deploy con ruoli separati, non ritenuto necessario per ora).
- Nessuna cifratura di alcun dato — scelta esplicita, coerente con l'uso
  in fase di rivendita (storico verificabile da un futuro acquirente).