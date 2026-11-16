# MyCarBook — inventario dei dati e proposta di riduzione

Riferimento: audit MCB-05 / MCB-06 ([AUDIT.md](AUDIT.md)). Stato del codice
dopo le correzioni del 16/11/2026, contratto MyCarBookV2 invariato.

## 1. Dove finisce ogni dato

### Sulla catena LUKSO (pubblico, permanente, non cancellabile da nessuno)

| Dato | Dove | Chi lo scrive | Note |
|---|---|---|---|
| Indirizzo UP del proprietario ↔ veicolo | `Transfer`, `VehicleMinted(owner)`, `tokenOwnerOf` | mint / trasferimento | la UP spesso ha nome e avatar (LSP3) |
| Data immatricolazione, data di possesso, km al mint | storage `vehicleInfo`, evento `VehicleMinted` | mint | non modificabili |
| Km massimo registrato | storage `vehicleInfo.km` | ogni intervento | solo in salita |
| Per ogni intervento: data, km, categorie, importo (centesimi), descrizione libera fino a 280 byte, indirizzo di chi registra (`loggedBy`) | evento `InterventionLogged` | proprietario corrente | la descrizione può contenere dati personali scritti dall'utente; il link al documento è in coda alla descrizione |
| Impronta (keccak256) e link `ipfs://` della scheda veicolo | `TokenIdDataChanged` / `getDataForTokenId(LSP4Metadata)` | mint; owner del contratto con `setDataForTokenId` | anche le versioni precedenti restano negli eventi |

### Su IPFS (pubblico per chi conosce il CID; il CID è sulla catena)

| Dato | File | Note |
|---|---|---|
| Nome del veicolo, marca, modello, allestimento, **targa**, **VIN** | JSON LSP4Metadata | targa e VIN facoltativi; pinnato sul nodo ChainIntegrate, annunciato alla rete IPFS, possibili copie su gateway terzi |
| Foto del veicolo | immagine | ricodificata nel browser: senza EXIF/GPS (il backend rifiuta immagini con metadati) |
| Documento dell'intervento (fattura, ecc.) | immagine o PDF | immagini ripulite; **PDF caricati così come sono** (autore, programma, ecc.) e con il contenuto visibile (indirizzi, nomi) |

### Sul server ChainIntegrate (non pubblico)

| Dato | Dove | Conservazione |
|---|---|---|
| Indirizzo IP | log di Nginx; memoria del rate limit (15 min) | log Nginx: secondo la rotazione del VPS (da definire) |
| Firma e indirizzo UP degli upload | solo in memoria durante la verifica; nonce usati per ~6 min | non salvati |
| CID pinnati, scopo, istante (senza indirizzo) | `backend/data/pins.jsonl` | finché serve alla pulizia degli orfani |
| Lista manuale di accesso foto | `backend/allowed-addresses.json` | gestione manuale |

### Terze parti

- Estensione / app Universal Profile dell'utente e il suo RPC LUKSO.
- Gateway `api.universalprofile.cloud`: solo per i file non ancora
  presenti sul nostro nodo (da eliminare dopo il ripin, MCB-17).
- Backend: RPC pubblico LUKSO per verificare firme e livello membership.
- **Non più**: Google Fonts, jsDelivr, esm.sh (tutto servito dal nostro
  dominio).

## 2. Avvisi nel momento in cui l'utente scrive (fatto)

- Targa/VIN: riquadro accanto ai campi ("facoltativi, pubblici e
  permanenti, collegabili alla tua UP, lasciali vuoti se non ti servono") e
  casella di presa d'atto obbligatoria se uno dei due è compilato.
- Descrizione intervento: avviso sotto il campo (pubblica, permanente, non
  scrivere nomi/indirizzi).
- Foto: avviso pubblico/permanente + rimozione automatica dei metadati.
- Documento: avviso pubblico/permanente, invito a non allegare dati
  personali, nota che i PDF possono contenere dati nascosti.
- Schermata iniziale e "Come funziona": testo corretto, elenco dei dati
  pubblici, "Chi può modificare cosa".

## 3. Proposta per ridurre i dati personali

Senza nuovo contratto (solo app/backend):

1. **Targa e VIN non più in chiaro per default.** Proposta: il campo VIN
   salva solo le ultime 6 cifre (sufficienti a un acquirente per un
   confronto con il libretto) oppure un'impronta `keccak256(VIN
   normalizzato + tokenId)` verificabile da chi ha il VIN; targa non
   salvata (cambia con la reimmatricolazione e identifica il proprietario).
   Da decidere: utilità per la rivendita contro esposizione.
2. **Documenti**: accettare solo immagini (ripulite) oppure convertire i PDF
   in immagine nel browser (pdf.js) prima dell'upload; in alternativa
   ripulire i metadati PDF lato server (qpdf) prima del pin.
3. **Descrizione libera**: rilevare nel browser numeri di telefono,
   email, codici fiscali, IBAN e chiedere conferma prima della firma.
4. **Importi**: renderli facoltativi in modo esplicito (già lo sono) e
   permettere fasce invece della cifra esatta nelle statistiche.
5. **Nodo IPFS**: `Reprovider.Strategy=pinned` (o nessun annuncio) per non
   pubblicizzare i CID sulla rete; procedura scritta per smettere di
   servire un file su richiesta dell'interessato (unpin + verifica).
6. **Log Nginx**: conservazione breve (es. 14 giorni) e IP troncati.

Con il nuovo contratto (rimandato):

7. Scheda veicolo modificabile solo dal proprietario del token (rettifica),
   niente riscrittura da parte dell'owner del contratto (MCB-04).
8. Dati identificativi fuori dalla catena e fuori da IPFS pubblico,
   condivisi con l'acquirente su richiesta (es. cifrati con una chiave che
   il venditore consegna), mantenendo on-chain solo l'impronta.

## 4. Informativa

Pubblicata in [`frontend/privacy.html`](../frontend/privacy.html) il
16/11/2026, con la stessa impostazione dell'informativa di ChainIntegrate
Account (repository up-onboarding): stesso titolare, contatti,
conservazione dei log (massimo 30 giorni) e diritti. Se cambia il
trattamento (nuovi campi, backup, terze parti) vanno aggiornate insieme
la pagina, la sua data e questo documento. Elementi coperti:

- titolare: ChainIntegrate (dati societari), contatto info@chainintegrate.it;
- finalità: tenuta del libretto di manutenzione scelto dall'utente;
  conservazione dei file su IPFS; verifica dei permessi (membership);
- base giuridica: da indicare (esecuzione del servizio richiesto);
- dati trattati e dove: sezione 1;
- natura pubblica e permanente dei dati sulla catena; cosa può essere
  rimosso (pin sul nostro nodo, log) e cosa no (catena, copie altrui);
- destinatari/terze parti: sezione 1 "Terze parti";
- conservazione: sezione 1;
- diritti e come esercitarli; procedura di rimozione dal nodo;
- data dell'ultimo aggiornamento.
