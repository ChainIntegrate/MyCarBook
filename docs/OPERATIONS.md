# MyCarBook — operazioni sul server

Procedure per rilasciare e mantenere le correzioni dell'audit 2026-11
([AUDIT.md](AUDIT.md)). Percorsi d'esempio: adattarli al VPS.

## 1. Backend

```bash
cd /var/www/mycarbook/backend
npm ci --omit=dev
```

Nuove variabili in `backend/.env` (vedi `backend/.env.example`):

| Variabile | Valore |
|---|---|
| `IPFS_API_URL` | API Kubo del nodo (obbligatoria, non ha più un default) |
| `IPFS_API_AUTH` | facoltativa, intestazione `Authorization` se sul nodo è attivo `API.Authorizations` |
| `AUTH_DOMAIN` | `mycarbook.chainintegrate.it` |
| `ALLOWED_CHAIN_IDS` | `42` |
| `ADMIN_UP_ADDRESS` | UP owner del contratto (oggi `0x4a2605796e0d91A9667d6E30365aEEC384C48c27`) |
| `ADMIN_SIGNER_ADDRESS` | `any` (qualunque controller della UP owner con permesso SIGN), oppure l'indirizzo di una sola chiave controller; vuoto = admin disattivato |
| `TRUST_PROXY` | `loopback` (default) |

Firma admin: con `ADMIN_SIGNER_ADDRESS=any` (scelta in produzione) basta
la firma della UP owner da qualunque dispositivo, cioè da qualunque suo
controller con permesso SIGN, verificata on-chain dal KeyManager. Per
restringere a un solo dispositivo si indica l'indirizzo della sua chiave
controller: per ricavarlo, sul sito connesso con la UP owner, in console:

```js
const s = await new ethers.BrowserProvider(window.lukso).getSigner();
const msg = "MyCarBook: verifica chiave admin";
console.log(ethers.verifyMessage(msg, await s.signMessage(msg)));
```

Quando l'ownership del contratto verrà spostata: aggiornare
`ADMIN_UP_ADDRESS` e riavviare.

```bash
pm2 restart mycarbook-backend   # nome del processo PM2 in uso
curl -s https://mycarbook.chainintegrate.it/api/health
```

Verifica del rate limit per IP: nei log PM2 non devono comparire avvisi
`ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`.

## 2. Frontend e Nginx

1. Copiare `frontend/` (incluse `js/`, `css/`, `vendor/`, `fonts/`).
2. `sudo cp deploy/nginx/security-headers.conf /etc/nginx/snippets/mycarbook-security-headers.conf`
3. Confrontare il vhost con `deploy/nginx/mycarbook.conf`: `include` dello
   snippet nel `server` e in ogni `location` con `add_header`; nella
   `location /api/` `proxy_set_header X-Forwarded-For $remote_addr;`;
   `try_files … =404`.
4. **Fase 1**: nello snippet rinominare `Content-Security-Policy` in
   `Content-Security-Policy-Report-Only`, `sudo nginx -t && sudo systemctl
   reload nginx`, usare l'app con l'estensione UP (connessione, mint con
   foto, intervento con documento, cambio lingua, pannello admin) e
   controllare che la console (F12) non mostri violazioni.
5. **Fase 2**: ripristinare `Content-Security-Policy`, ricaricare Nginx.

Verifica: `curl -sI https://mycarbook.chainintegrate.it/ | grep -i -E
'content-security|nosniff|referrer|frame'`.

Le librerie servite si rigenerano con `cd tests && npm ci && npm run
vendor` (aggiorna `vendor/SHA256SUMS`; se cambiano i file, aggiornare gli
attributi `integrity` negli HTML — un test lo controlla).

## 3. Nodo IPFS: ripin, controllo, pulizia, backup (MCB-17)

Dal VPS del backend (serve l'API Kubo):

```bash
cd /var/www/mycarbook/backend
node scripts/check-pins.js --verbose     # elenca i CID e quelli mancanti
node scripts/check-pins.js --repin       # ripinna i mancanti
node scripts/check-pins.js               # deve dire: tutti i file sono pinnati
```

`--repin` prova prima `pin/add` dalla rete IPFS, poi scarica un CAR dal
gateway di riserva (`GATEWAY_FALLBACKS`, default `api.universalprofile.cloud`)
e lo importa con `dag/import`; Kubo verifica ogni blocco contro il CID.
Il gateway del nodo ha `Gateway.NoFetch=true`, ma `pin/add` via API non ne
è influenzato.

Pin orfani (mint/interventi annullati dopo l'upload):

```bash
node scripts/check-pins.js --gc-orphans          # elenco
node scripts/check-pins.js --gc-orphans --apply  # rimozione (solo > 48 h, solo se l'elenco CID è completo)
```

Timer (adattare utente e percorsi nelle unità):

```bash
sudo cp deploy/systemd/mycarbook-*.service deploy/systemd/mycarbook-*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mycarbook-check-pins.timer mycarbook-ipfs-backup.timer
```

Backup fuori server: impostare in `.env` `BACKUP_REMOTE` (es.
`rclone:b2:mycarbook-ipfs` oppure `rsync:backup@altro-host:/srv/mycarbook`)
ed eventualmente `BACKUP_DIR`, `KEEP_LOCAL`. Ripristino: `ipfs dag import
<file>.car` per ogni file del manifest (il CID risultante è lo stesso).

Dopo il ripin di tutti i file, il gateway LUKSO di riserva può essere tolto
da `frontend/js/lib/ipfs.js` e dalla CSP.

## 4. Infrastruttura ancora da fare

- Tratto VPS → nodo IPFS: tunnel WireGuard/SSH o TLS + `API.Authorizations`
  (Kubo ≥ 0.25), poi `IPFS_API_AUTH` (MCB-13).
- Gateway `ipfs.chainintegrate.it`: intestazioni applicate il 16/11
  (`deploy/nginx/ipfs-gateway-headers.conf`, nel blocco `server` HTTPS di
  `/etc/nginx/sites-available/ipfs-gateway` sul server del nodo). Ogni
  modifica va provata prima in Report-Only, perché il gateway è condiviso
  con le altre app; al primo PDF in chiaro aperto direttamente dal gateway,
  verificare che si visualizzi (MCB-10).
- Nodo: valutare `Reprovider.Strategy=pinned` (MCB-06).
- Backend: `RPC_URL_42` verso il nodo LUKSO proprio (MCB-16).

## 5. Conservazione dei log (massimo 30 giorni)

L'informativa (`frontend/privacy.html`, punto 5) dice che i registri
tecnici del server sono conservati al massimo 30 giorni.

- Nginx: ruotato da logrotate (default Ubuntu: 14 giorni), verificare con
  `grep -E "rotate|daily|weekly" /etc/logrotate.d/nginx`.
- PM2 (`/root/.pm2/logs/`): senza rotazione crescono per sempre. Una volta,
  sul server (vale per tutti i processi PM2 di root):

```bash
sudo pm2 install pm2-logrotate
sudo pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
sudo pm2 set pm2-logrotate:retain 30
sudo pm2 set pm2-logrotate:compress true
```

  Per svuotare subito i log vecchi di MyCarBook: `sudo pm2 flush mycarbook-backend`.
