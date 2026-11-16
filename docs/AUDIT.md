# Audit 2026-11 — MyCarBook

Revisione di contratto, backend, frontend e infrastruttura del 4 novembre
2026 (report `04-mycarbook.md` e `audit-mycarbook.md`, revisione `e38be66`).
Ogni punto è tracciato qui con il suo stato.

Il repository è pubblico: i punti di sicurezza ancora aperti sono descritti
in modo generico finché non vengono corretti; il dettaglio tecnico viene
aggiunto insieme alla correzione.

Legenda: ✅ corretto, con test negativo, in produzione · ⏳ aperto ·
📌 limite accettato e documentato: richiederebbe un nuovo contratto
(versione 2), oggi non previsto · ➖ segnalazione non confermata

Postura al 4/11: debole (1 High, 7 Medium, 7 Low, 2 Info). Correzioni
rilasciate in produzione il 16/11/2026 (PR #1 e seguenti): vedi
[Rilascio](#rilascio).

**Decisione del 16/11/2026: nessun nuovo contratto per ora.** MyCarBook
resta un libretto **autodichiarato**, non uno storico certificato, con i
limiti scritti in modo chiaro nell'app, in "Come funziona", nella guida e
nell'[informativa](../frontend/privacy.html). I punti 📌 (MCB-04, MCB-08,
MCB-11, MCB-12) sono limiti accettati, come i punti "Documented" / "Version 2"
di GasTrace. Condizioni:
- la UP owner del contratto può sostituire la scheda di qualunque veicolo:
  i permessi dei suoi controller vanno tenuti al minimo (report generale,
  GEN-01);
- le richieste dei proprietari (correzione, rimozione di targa/VIN, foto)
  si gestiscono con la procedura dell'informativa, punto 7.
Un nuovo contratto andrebbe riconsiderato se MyCarBook dovesse essere
presentato come storico affidabile per la compravendita (officine,
concessionari) o se gli utenti crescessero al punto da rendere le
correzioni a mano frequenti.

## Metodo

- Prima di ogni correzione, ogni punto è stato riconfermato sul codice a
  `e38be66` (identico al `main` del 4/11): file e righe sono indicati sotto
  come **Presente a e38be66**. Le righe di `index.html` coincidono con il
  report salvo dove indicato.
- Ogni correzione ha un test negativo che prova il bypass e ne verifica il
  rifiuto; dove utile anche una controprova che riproduce il problema con la
  versione precedente.
  - `backend/test/` (`cd backend && npm test`, 42 test): backend reale
    (Express) con UP simulate secondo ERC-1271/LSP6 (firma ECDSA di un
    controller), nodo Kubo e RPC simulati via HTTP.
  - `tests/frontend/` (jsdom, 22 test) e `tests/e2e/` (14 test): Chromium
    con una finta estensione UP e una catena simulata, pagine servite da
    **Nginx reale con il vhost e le intestazioni di `deploy/nginx/`** (TLS
    self-signed), backend reale dietro Nginx.
- Nessun deploy di contratti: nessuna correzione lo richiede (le parti che
  lo richiederebbero sono 📌). Nessuna chiave usata.
- Non verificabile da qui: la catena e il gateway LUKSO reali (rete della
  sessione di lavoro bloccata), il VPS e il nodo IPFS. Le procedure da
  eseguire lì sono in [OPERATIONS.md](OPERATIONS.md).

## Sicurezza

- ✅ **MCB-01 — XSS memorizzato tramite metadata del veicolo e marcatore
  `[doc:]`** (High).
  Presente a e38be66: `frontend/index.html:1057` (`<img src="${…}"
  onerror=…>` dentro `card.innerHTML`, riga 1059), `:1548-1551` (la regex
  del marcatore cattura `"` e finisce in `<a href="${…}">`), `:1562`
  (`entry.innerHTML`); `escapeHtml` (`:1101`) non codificava le virgolette;
  nessuna CSP (`:1-35`, e nessuna intestazione dal vivo).
  Correzione:
  - tutto il codice è passato da `index.html` a `frontend/js/` (e da
    `how-it-works.html` / `admin-collection.html`); gli stili in
    `frontend/css/`; zero script, gestori `on*` e attributi `style` inline;
  - i dati da catena/IPFS sono resi solo con `createElement` +
    `textContent`/proprietà (`js/lib/render.js`); `src`/`href` solo da link
    `ipfs://<CID>` validati (`js/lib/ipfs.js`), altrimenti nessun
    link/immagine; un marcatore `[doc:]` non valido resta testo;
  - i riepiloghi usano `html\`…\`` (`js/lib/html.js`): ogni valore è
    codificato (virgolette comprese) e `innerHTML` accetta solo questi
    frammenti (controllo statico nei test);
  - CSP rigida e intestazioni nel vhost: `deploy/nginx/security-headers.conf`
    (`script-src 'self'`, `style-src 'self'`, `frame-ancestors 'none'`,
    `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`),
    `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
    `X-Frame-Options`, `Permissions-Policy`, HSTS; incluse anche nelle
    `location` con propri `add_header`.
  Test: `tests/e2e/xss-csp.test.mjs` (veicolo avvelenato spinto nella UP
  della vittima, payload del report su icona, `[doc:]` e descrizione: nessuna
  esecuzione, nessun attributo `on*`; controprova CSP: `onerror`, `<script>`
  e `javascript:` iniettati vengono bloccati; controprova del template di
  e38be66 che esegue il payload), `tests/frontend/safe-render.test.mjs`,
  `tests/frontend/static-checks.test.mjs`, `tests/e2e/flows.test.mjs`
  (intestazioni sul vhost reale, tre pagine senza violazioni CSP).
- ✅ **MCB-03 — `/api/pin-json` non autenticato** (Medium).
  Presente a e38be66: `backend/server.js:174-201` (solo il controllo della
  chiave `LSP4Metadata`, fino a 1 MB, `:170`).
  Correzione: firma ERC-1271 obbligatoria anche qui, con il formato comune
  di MCB-09 (contenuto, nonce, dominio, rete). Due scopi:
  - `metadata` (mint): qualunque UP, ma **schema rigido**
    (`backend/lib/metadata-schema.js`): solo i campi che l'app scrive,
    attributi Brand/Model/Trim/Plate/VIN, lunghezze massime, immagini solo
    `ipfs://<CID>`, nessuna chiave extra, corpo massimo 32 KB;
  - `admin` (pannello): solo la chiave admin configurata (punto 3).
  Il rate limit resta (20/15 min, ora per IP). Viene pinnato esattamente il
  testo firmato, lo stesso di cui il contratto registra il keccak256.
  Nota sulla richiesta "chiave admin specifica": `/api/pin-json` serve anche
  al mint, che è aperto a chiunque per design. Riservarlo alla sola chiave
  admin avrebbe impedito i mint degli utenti; la chiave admin è quindi
  richiesta per lo scopo `admin`, mentre per il mint basta la firma della
  propria UP più lo schema rigido. Se si vuole davvero il pin solo-admin
  (mint gestiti a mano), è una riga in `lib/app.js`.
  I pin di mint annullati sono gestiti dalla pulizia degli orfani (MCB-17).
  Test: `backend/test/pin-json.test.js` (senza firma, controller di
  un'altra UP, contenuto cambiato dopo la firma, replay, altro dominio,
  testnet, scaduta/futura, chiavi extra, payload XSS nell'icona, attributo
  non ammesso, rate limit ancora attivo).
- ✅ **Punto 3 — Upload admin legati all'owner configurato.**
  Presente a e38be66: `backend/server.js:42-45` (owner hard-coded nel
  codice) e `:116-119` + `:97-106`: valeva la firma di qualunque controller
  della UP owner con permesso SIGN.
  Correzione (`backend/lib/auth.js`): la UP admin si legge da `.env`
  (`ADMIN_UP_ADDRESS`, da aggiornare quando l'ownership verrà spostata);
  se manca, le azioni admin sono disattivate. `ADMIN_SIGNER_ADDRESS`
  sceglie quali chiavi della UP valgono:
  - `any` (**scelta in produzione dal 16/11**): qualunque controller della
    UP owner con permesso SIGN, verificato on-chain da `isValidSignature`
    tramite il KeyManager, quindi la firma funziona da ogni dispositivo;
  - un indirizzo: solo quella chiave controller (più restrittivo, da
    aggiornare a ogni cambio di dispositivo);
  - vuoto: azioni admin disattivate (un errore di configurazione non apre
    l'accesso).
  Motivo della scelta: il legame a una sola chiave protegge solo gli upload
  admin sul nostro nodo IPFS, non il contratto. Un controller compromesso
  della UP owner con permessi di chiamata potrebbe comunque usare
  `setData`/`setDataForTokenId` puntando a file ospitati altrove: quel
  rischio si gestisce sui permessi dei controller della UP (report
  generale, GEN-01), non nel backend. Restano in ogni caso la firma legata
  al contenuto, monouso, solo mainnet e lo schema dei file (MCB-09, MCB-10).
  Test: `backend/test/admin.test.js` (modalità `any`: altro controller della
  UP owner accettato; UP diversa → 403; chiave che non è controller della UP
  owner → 401; senza `ADMIN_UP_ADDRESS` → 403; valore non valido → il
  server non parte. Modalità indirizzo: altro controller → 403, chiave
  admin per un'altra UP → 403, chiave tolta dai controller → 401, variabile
  vuota → 403).
- ✅ **MCB-02 — Rate limit unico per tutti dietro Nginx** (Medium).
  Presente a e38be66: `backend/server.js:178-184`, `:214-220`, ascolto su
  127.0.0.1 (`:254`), nessun `trust proxy`.
  Correzione: `app.set("trust proxy", "loopback")` (configurabile con
  `TRUST_PROXY`); il vhost imposta `X-Forwarded-For $remote_addr`.
  Test: `backend/test/rate-limit.test.js` (un client che esaurisce il limite
  non blocca gli altri; controprova con la configurazione precedente: blocco
  globale).
- ✅ **MCB-09 — Firma degli upload poco vincolata; lista consultabile da
  chiunque** (Low).
  Presente a e38be66: `backend/server.js:62-64` (messaggio senza file,
  nonce, dominio), `:92-95` (riusabile per 5 minuti, rifiuto dell'orologio
  in anticipo), `:32-35`/`:88` (testnet accettata), `:203-207` (`GET
  /api/photo-access/:address` pubblica).
  Correzione: il messaggio firmato contiene dominio, scopo, UP, rete,
  SHA-256 del contenuto, nonce casuale e istante; il server ricalcola
  l'impronta del contenuto ricevuto, consuma il nonce (uso singolo),
  accetta solo `ALLOWED_CHAIN_IDS` (default 42) e un anticipo dell'orologio
  fino a 60 s. La verifica della lista è `POST /api/photo-access` firmata
  dalla UP stessa (pulsante "Sei nella lista di accesso? Verifica").
  Formato identico tra `backend/lib/auth.js` e
  `frontend/js/lib/auth-message.js` (test dedicato).
  Test: `backend/test/pin-file.test.js`, `pin-json.test.js`,
  `photo-access.test.js`, `tests/frontend/logic.test.mjs`.
- ✅ **MCB-10 — Tipo del file deciso dal client** (Low).
  Presente a e38be66: `backend/server.js:226-229` (`mimetype` dichiarato).
  Correzione: tipo ricavato dai primi byte (`backend/lib/files.js`): foto
  solo JPEG/PNG/WebP, documenti anche PDF; nome e tipo del file pinnato
  decisi dal server.
  Test: SVG/HTML dichiarati `image/png` rifiutati, PDF non accettato come
  foto, nome `../../evil.html` sostituito (`backend/test/pin-file.test.js`).
  Parte gateway (16/11): verificato dal vivo che `ipfs.chainintegrate.it`
  non mandava né `nosniff` né CSP. Applicate sul server del nodo le
  intestazioni di `deploy/nginx/ipfs-gateway-headers.conf`: `nosniff`,
  `Referrer-Policy: no-referrer` e una CSP senza script (`default-src
  'none'`, `object-src 'self'` per i PDF in chiaro), prima in Report-Only.
  Verificati: immagine aperta dal gateway, allegato cifrato scaricato e
  aperto da Traceability. Da riverificare al primo PDF in chiaro aperto
  direttamente dal gateway (oggi nessuno su MyCarBook).
- ✅ **MCB-07 — multer 1.x e body-parser vulnerabili** (Medium).
  Presente a e38be66: `backend/package-lock.json` (multer `1.4.5-lts.2`,
  body-parser `1.20.6`, express `4.22.2`); multer prima della verifica
  della firma (`server.js:222`).
  Correzione: multer 2.5.0, express 4.22.3, body-parser 1.20.9, qs 6.16.2,
  proxy-addr 2.0.8; `npm audit`: 0 vulnerabilità. Firma e permessi sono
  verificati **prima** di leggere il multipart; limiti `files: 1, fields: 0,
  parts: 1`; ogni errore del parser diventa 4xx.
  Test: multipart troncato con e senza firma → 4xx e processo vivo, campi
  extra rifiutati, file oltre 5 MB → 413 (`backend/test/pin-file.test.js`).
- ⏳ **MCB-13 — API del nodo IPFS in chiaro, protetta solo da filtro IP**
  (Low).
  Presente a e38be66: `backend/server.js:15-19`, `backend/.env.example:3`.
  Fatto: l'indirizzo non è più un default nel codice (`IPFS_API_URL`
  obbligatorio), supporto a `IPFS_API_AUTH` (autenticazione Kubo
  `API.Authorizations`), test con nodo che richiede l'intestazione
  (`backend/test/pins.test.js`). Aperto, **rischio accettato per ora**
  (16/11): tunnel/TLS tra VPS e nodo. Sul tratto viaggiano solo file
  destinati a essere pubblici, la porta dell'API non è raggiungibile
  dall'esterno e il controllo giornaliero segnala i file mancanti; da
  rivedere se il nodo ospiterà dati riservati (procedura in OPERATIONS.md).
  L'IP resta nella cronologia git: la protezione vera è il firewall del nodo.
- 📌 **MCB-08 — Funzioni a pagamento non imposte dal contratto** (Low).
  Presente a e38be66: `contracts/MyCarBookV2.sol:131-158` e `:91-111`;
  `how-it-works.html:204/269` ("checked directly on-chain").
  Il pin sul nostro nodo è già riservato ai livelli giusti (backend). Il
  testo ora dice che il livello è letto dall'app e che è una comodità
  dell'app, non una regola del contratto. Limite dei bit di categoria e
  controllo del livello on-chain: da prevedere nel prossimo contratto.
  Test: `tests/frontend/static-checks.test.mjs` (frase rimossa).

## Privacy

- ✅ **MCB-05 — "Visibili solo a te"; nessun avviso su targa e VIN; nessuna
  informativa** (Medium; High nel secondo report).
  Presente a e38be66: `frontend/index.html:368`, `:547` (EN), `:655` (IT);
  campi targa/VIN `:403-409` senza avviso; nessun link a un'informativa.
  Fatto:
  - testo corretto in IT ed EN ("…è pubblico e permanente: chiunque può
    leggerlo, non solo tu"); `og:description` non dice più "no backend";
  - accanto a targa e VIN: avviso che sono facoltativi, pubblici e
    permanenti, collegabili alla UP, con il consiglio di lasciarli vuoti; se
    uno dei due è compilato serve la casella di presa d'atto, altrimenti il
    riepilogo non si apre;
  - sotto la descrizione dell'intervento: avviso che data, km, importo e
    descrizione sono pubblici e permanenti e di non scrivere dati personali;
  - "Come funziona": elenco di cosa è pubblico, cosa si può e non si può
    cancellare, contatto; link "Dati e privacy" a piè di pagina;
  - inventario dei campi e proposta di riduzione: [PRIVACY.md](PRIVACY.md).
  - informativa sulla privacy in `frontend/privacy.html` (IT/EN, 16/11),
    con la stessa impostazione di quella di ChainIntegrate Account
    (up-onboarding): titolare, cosa è pubblico, cosa riceve e conserva
    ChainIntegrate e per quanto, terze parti, correzioni e cancellazione
    (cosa si può fare e cosa no), diritti; collegata dal piè di pagina
    dell'app e da "Come funziona".
  La guida su www.chainintegrate.it è stata corretta e pubblicata il 16/11.
  Test: `tests/e2e/flows.test.mjs` (mint con targa senza presa d'atto:
  nessun riepilogo, nessuna firma; testo servito), `static-checks`.
- ✅ **MCB-06 — Foto e documenti pinnati con EXIF/GPS** (Medium).
  Presente a e38be66: `frontend/index.html:1255-1290` (foto originale,
  `formData.append("image", file)` a `:1272`), `:1299-1325` (documento);
  backend inoltra i byte invariati (`server.js:243-244`).
  Correzione: foto e documenti-immagine ricodificati nel browser con un
  `<canvas>` (`js/lib/image.js`: via EXIF, GPS, dati fotocamera); il backend
  **rifiuta** JPEG/PNG/WebP che contengono ancora EXIF/XMP/IPTC/testo
  (anche dal pannello admin, che ora ricodifica). PDF: non ripulibili nel
  browser, l'avviso lo dice esplicitamente. Upload dopo la conferma
  dell'utente (già così); i pin dei mint/interventi annullati vengono tolti
  dalla pulizia degli orfani (MCB-17). Errore di upload del documento: ora
  blocca il salvataggio con il messaggio giusto (prima diceva "foto").
  Test: JPEG con EXIF GPS rifiutato (`backend/test/pin-file.test.js`); in
  Chromium una foto con EXIF GPS viene caricata ripulita
  (`tests/e2e/flows.test.mjs`).
  ⏳ `Reprovider.Strategy` del nodo: da valutare sul nodo (OPERATIONS.md).
- ✅ **MCB-04 (testi) — "Nulla viene mai cancellato o sovrascritto"**
  (Medium).
  Presente a e38be66: `how-it-works.html:194` (EN), `:259` (IT), `:216/:281`
  ("tamper-proof"/"non falsificabile"), `README.md:119-122`.
  Fatto: "Come funziona" ha la sezione "Chi può modificare cosa": voci di
  intervento immodificabili da chiunque; date e km iniziali immodificabili;
  dati del veicolo (nome, marca, modello, allestimento, targa, VIN, foto)
  non modificabili dal proprietario, ma sostituibili dall'account
  ChainIntegrate che gestisce il contratto, per qualunque veicolo. Stesso
  avviso nel README e nel pannello admin.
  📌 Il potere dell'owner e l'impossibilità per il proprietario di
  correggere i propri dati restano (decisione del 16/11). Lo stesso potere
  è la procedura per le richieste del proprietario: scheda nuova, corretta
  o senza targa/VIN, e scheda vecchia tolta dal nodo; il riferimento resta
  nello storico della catena (informativa, punto 7).
  Test: `static-checks` (frasi rimosse).

## Funzionalità e affidabilità

- ✅ **MCB-17 — Dati dei veicoli non presenti sul nodo IPFS proprio**
  (Medium).
  Presente a e38be66: `frontend/index.html:1028-1031` (nodo proprio, poi
  gateway LUKSO in silenzio); verifica dal vivo del 4/11: 3 metadata e 2
  foto solo sul gateway LUKSO.
  Fatto:
  - `backend/scripts/check-pins.js`: raccoglie dalla catena tutti i CID
    referenziati (metadata di collezione e di ogni veicolo, anche le versioni
    sostituite, immagini citate, documenti `[doc:]`), controlla che siano
    pinnati sul nodo; `--repin` li ripinna dalla rete IPFS o, in mancanza,
    importando un CAR dal gateway di riserva (Kubo verifica ogni blocco; un
    CAR con radice diversa viene scartato); `--gc-orphans [--apply]` toglie
    i pin caricati dal backend e mai usati sul contratto dopo 48 h, solo se
    l'elenco dei CID è completo;
  - `backend/scripts/backup-ipfs.sh`: esporta i CAR di tutti i CID con
    manifest SHA-256 e li copia fuori dal VPS (`BACKUP_REMOTE`, rclone o
    rsync); unità systemd giornaliera/settimanale in `deploy/systemd/`;
  - il backend registra i CID che pinna (`data/pins.jsonl`, senza
    indirizzi).
  Test: `backend/test/pins.test.js` (file mancante segnalato e uscita 1,
  CAR con radice sbagliata rifiutato, orfani: mai i referenziati, mai con
  elenco incompleto, mai i recenti; manifest; CLI completa con RPC e Kubo
  simulati).
  Eseguito sul VPS il 16/11: 9 CID referenziati dal contratto, 8 mancanti
  (caricati ai tempi di Pinata: metadata della collezione e dei 3 veicoli,
  2 immagini di collezione, 2 foto di veicoli), tutti ripinnati; controllo
  successivo: tutti presenti. Attivo il controllo giornaliero con ripin
  automatico (`mycarbook-check-pins.timer`).
  ⏳ Backup fuori server: rimandato per scelta (pochi utenti). Fino ad
  allora i file stanno sul nodo proprio e su Pinata (da non chiudere prima
  del backup). Il backup contiene schede veicolo con targa/VIN: la
  destinazione deve essere privata.
  ⏳ Il gateway LUKSO di riserva resta nel frontend e nella CSP come rete di
  sicurezza; si può togliere dopo un periodo senza file mancanti.
- ✅ **MCB-11 — Veicoli "spinti" da terzi, lista che si rompe, nessun
  trasferimento** (Low).
  Presente a e38be66: `frontend/index.html:973-1003` (un errore su un token
  interrompe tutta la lista), `:1110-1112` (`.replace` su un'icona non
  stringa), ABI senza `transfer` (`config.js:22-34`), `how-it-works.html:199`.
  Fatto: lettura difensiva di ogni token (`js/lib/metadata.js`), un token
  malformato viene saltato o mostrato senza nome; "Nascondi dalla mia lista"
  (preferenza locale) con "Mostra veicoli nascosti"; "Trasferisci
  all'acquirente" con LSP8 `transfer(…, force=false)` (solo verso UP o
  contratti che accettano LSP8), indirizzo validato.
  📌 Impedire l'invio non richiesto (`force=true`) richiederebbe un nuovo
  contratto: accettato (finora nessun trasferimento sul contratto).
  Test: `tests/e2e/xss-csp.test.mjs` (token malformato non rompe la lista),
  `tests/e2e/flows.test.mjs` (nascondi/mostra; trasferimento: indirizzo non
  valido, proprio o del contratto rifiutati, poi `force=false`),
  `tests/frontend/logic.test.mjs`.
- ✅ **MCB-12 — Km sbagliati permanenti; dati autodichiarati presentati
  come verificati** (Low).
  Presente a e38be66: `contracts/MyCarBookV2.sol:150-152`;
  `how-it-works.html:216/281`.
  Fatto: km solo interi fino a 2.000.000; un salto di oltre 100.000 km
  rispetto al massimo registrato richiede una conferma esplicita; nel
  dettaglio "Dati inseriti dai proprietari del veicolo, non verificati da
  nessuno"; testi senza "tamper-proof". 📌 Limite on-chain, correzione dei
  km e avviso "stesso VIN su altri token": nuovo contratto o indicizzatore.
  Test: `tests/e2e/flows.test.mjs` (km fuori scala rifiutati; salto grande
  senza conferma: nessuna transazione), `tests/frontend/logic.test.mjs`.
- ✅ **MCB-14 — Storico riletto da capo a ogni visualizzazione** (Low).
  Presente a e38be66: `frontend/index.html:1489-1532`, ricarica al cambio
  lingua `:814`, dopo ogni voce `:1687`.
  Fatto: lettura incrementale con memoria per sessione
  (`js/lib/log-cache.js`): il cambio lingua ridisegna senza letture, dopo
  una nuova voce si leggono solo i blocchi nuovi. ⏳ Prima apertura ancora
  dal blocco di deploy (indicizzatore: da valutare).
  Test: `tests/e2e/flows.test.mjs` (cambio lingua: zero `eth_getLogs`),
  `tests/frontend/logic.test.mjs`.

## Dipendenze e build

- ✅ **MCB-16 — Terze parti (Google Fonts, jsDelivr, esm.sh) senza SRI né
  CSP** (Info).
  Presente a e38be66: `frontend/index.html:28-33`, `:537`;
  `admin-collection.html:8`, `:66`; `how-it-works.html:25-27`.
  Fatto: font (Oswald, Inter, JetBrains Mono, latin/latin-ext) in
  `frontend/fonts/`, ethers 6.13.4 (stesso file npm) e erc725.js 0.28.2
  (bundle ESM) in `frontend/vendor/`, impronte in `vendor/SHA256SUMS`,
  `integrity` sugli script, rigenerabili con `cd tests && npm run vendor`.
  Resta solo il gateway LUKSO di riserva (MCB-17) e l'RPC dell'estensione
  UP dell'utente. ⏳ Backend: usa ancora l'RPC pubblico LUKSO
  (`RPC_URL_42` per puntare al nodo proprio).
  Test: in Chromium nessuna richiesta fuori dal sito e dai due gateway; font
  caricati; impronte e `integrity` verificate (`static-checks`).
- ✅ **MCB-15 — `package.json` della radice sovrascritto, `ethers` mancante
  nel backend** (Info).
  Presente a e38be66: `package.json` = manifest del backend (da `7aea9a5`),
  `backend/package.json:10-16` senza `ethers` e con "Proxy verso Pinata".
  Fatto: ripristinato il manifest Hardhat (`b55890c`): `npm ci` alla radice
  torna coerente con il lockfile; il contratto compila (solc 0.8.27, 0
  errori). `backend/package.json` con `ethers`, descrizione aggiornata,
  script di test.
- ➖ **Dipendenze dev della radice** (109 avvisi, solo strumenti Hardhat
  non deployati): non toccate. `tests/` (solo sviluppo): `ws` tramite
  ethers/jsdom lato Node, non incluso nei file serviti al browser.

## Rilascio

Rilascio del 16/11/2026 sul VPS (dettagli in [OPERATIONS.md](OPERATIONS.md)):

1. ✅ codice aggiornato a `main` (merge della PR #1);
2. ✅ backend: `npm ci` (0 vulnerabilità), nuove variabili in `.env`
   (`IPFS_API_URL`, `AUTH_DOMAIN`, `ALLOWED_CHAIN_IDS=42`, `TRUST_PROXY`,
   `ADMIN_UP_ADDRESS`), riavvio PM2; `/api/health` OK;
3. ✅ vhost Nginx: snippet delle intestazioni incluso solo nel blocco di
   mycarbook (gli altri siti del file condiviso non cambiano),
   `X-Forwarded-For`, file di servizio a 404. CSP verificata prima in
   Report-Only con l'estensione UP (nessuna violazione), poi applicata;
4. ✅ ripin dei file sul nodo e controllo giornaliero attivo (MCB-17);
5. ✅ `ADMIN_SIGNER_ADDRESS=any` (PR #2): upload admin attivi per la UP
   owner da qualunque suo controller con permesso SIGN;
6. ✅ informativa sulla privacy (`privacy.html`): online con il
   `git pull` successivo;
7. registri tecnici al massimo 30 giorni, come dice l'informativa: Nginx
   ruota già i log (14 giorni, default Ubuntu); per i log di PM2 serve
   `pm2-logrotate` (OPERATIONS.md, §5);
8. ✅ guida su www.chainintegrate.it aggiornata;
9. ✅ intestazioni di sicurezza sul gateway `ipfs.chainintegrate.it`
   (MCB-10 / GEN-03), CSP prima in Report-Only poi applicata;
10. ⏳ backup fuori server (rimandato).
