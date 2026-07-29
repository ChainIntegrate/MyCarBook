# MyCarBook

Storico manutenzioni veicolo on-chain su LUKSO. Mint libero (ogni utente
minta il proprio veicolo), nessuna cifratura (dato pubblico per natura della
chain — coerente con l'uso in fase di rivendita).

## Struttura

```
mycarbook/
├── contracts/
│   ├── MyCarBook.sol      — v1, DEPLOYATO su testnet e in uso, non toccare
│   └── MyCarBookV2.sol    — v2, DEPLOYATO su testnet (non ancora su mainnet)
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

- **v1** (`MyCarBook.sol`): deployato su testnet, indirizzo in
  `frontend/config.js`. È il contratto realmente in uso dal frontend oggi.
- **v2** (`MyCarBookV2.sol`): deployato su testnet a un indirizzo diverso
  (interfaccia cambiata, non è un upgrade in-place). Aggiunge:
  - **Fix bug km**: `logIntervention` ora aggiorna `vehicleInfo.km` solo se
    il nuovo valore è maggiore del massimo registrato — un intervento
    retroattivo con km più basso non fa più regredire il contachilometri
    mostrato (prima restava fermo al valore del mint anche dopo un intervento
    con km più alto, perché non veniva mai aggiornato on-chain).
  - **`categoryFlags`** (bitmask `uint8`) su ogni intervento: categorie
    combinabili — `CATEGORY_MECHANICAL=1`, `CATEGORY_BODYWORK=2`,
    `CATEGORY_TIRES=4`, `CATEGORY_ELECTRICAL=8`, `CATEGORY_CLEANING=16`,
    `CATEGORY_OTHER=32` — pensate per abilitare statistiche migliori.

  ⚠️ **`frontend/config.js` punta già all'indirizzo v2, ma l'ABI di
  `logIntervention` in quel file è ancora quella v1 (5 parametri, senza
  `categoryFlags`)** — finché non si aggiorna l'ABI e si aggiunge la UI per
  scegliere le categorie nel form intervento, **registrare un intervento
  fallirà** (mismatch di firma/selector tra frontend e contratto deployato).
  Questo è il prossimo passo da chiudere prima di considerare il v2 in uso.

- **Allegati intervento** (hash + upload documento): valutati e poi
  **scartati** — decisione presa di non certificare documenti/fatture,
  giudicato "troppo certificato" per lo scopo del progetto.

- **Foto veicolo al mint**: bottone sempre visibile, ma **disabilitato**
  finché l'indirizzo connesso non risulta autorizzato. Autorizzazione
  concessa in **due modi indipendenti** (basta uno dei due):
  1. Presente in `backend/allowed-addresses.json` (gestito a mano da Simone)
  2. Possiede almeno il tier **Bronze** su
     [ChainIntegrate Membership](https://github.com/ChainIntegrate/chainintegrate-membership)
     (letto on-chain via `tierOf(address)`, nessuna sincronizzazione manuale
     necessaria)

- **Immagine per singolo tokenId dopo il mint**: gestita da
  `admin-collection.html` (sezione dedicata) — solo l'owner del contratto
  può farlo, protezione reale on-chain (`setDataForTokenId` è `onlyOwner`).
  Fa merge col metadata esistente (non sovrascrive marca/modello/targa/VIN).

- **Metadata di collezione** (icona/banner/descrizione generali, visibili
  su universaleverything.io a livello di collezione): stessa pagina
  `admin-collection.html`, sezione separata.

- **Branding**: logo, favicon, banner — versione attuale generata con AI
  esterna da Simone (non dalle bozze fatte in questa chat, superate).

## TODO prima di considerare il v2 "in uso"

1. **Aggiornare l'ABI in `frontend/config.js`**: `logIntervention` deve
   includere `categoryFlags` (`uint8`) come nuovo parametro, stessa cosa per
   l'evento `InterventionLogged`.
2. **Aggiungere la UI categoria** nel form "Nuovo intervento" di
   `index.html`: checkbox multiple (meccanica/carrozzeria/gomme/elettrico/
   pulizia/altro), combinate in un bitmask prima di chiamare il contratto.
   Visibili a tutti, nessun gate membership su queste checkbox (deciso).
3. Giro di verifica manuale su testnet (mint + intervento con categorie +
   controllo che il km non regredisca dopo un intervento retroattivo).
4. Solo dopo: **deploy v2 su mainnet 42** con `scripts/deploy-v2.js`,
   aggiornare `contractAddress` mainnet in `config.js`.

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

## Non ancora implementato (rimandato volontariamente)

- Deploy v2 su mainnet (in attesa dei TODO sopra).
- Nessuna cifratura di alcun dato — scelta esplicita, coerente con l'uso
  in fase di rivendita (storico verificabile da un futuro acquirente).