// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// NOTA: verificare i path di import contro la versione installata di
// @lukso/lsp8-contracts / @lukso/lsp4-contracts nel Codespace (i path sono
// cambiati più volte tra versioni major del pacchetto).
import {LSP8IdentifiableDigitalAsset} from "@lukso/lsp8-contracts/contracts/LSP8IdentifiableDigitalAsset.sol";
import {_LSP8_TOKENID_FORMAT_NUMBER} from "@lukso/lsp8-contracts/contracts/LSP8Constants.sol";
import {_LSP4_TOKEN_TYPE_NFT, _LSP4_METADATA_KEY} from "@lukso/lsp4-contracts/contracts/LSP4Constants.sol";

/**
 * @title MyCarBook
 * @notice Storico manutenzioni veicolo on-chain, mint libero: ogni utente
 *         minta il proprio veicolo e scrive i propri interventi.
 *         Nessun issuer terzo, nessuna cifratura (dato pubblico per natura
 *         della chain, coerente con l'uso in fase di rivendita).
 */
contract MyCarBook is LSP8IdentifiableDigitalAsset {
    uint256 private _nextTokenId = 1;

    uint256 public constant MAX_DESCRIPTION_LENGTH = 280;

    struct VehicleInfo {
        uint256 registrationDate; // immatricolazione, obbligatoria (>0)
        uint256 purchaseDate;     // acquisto/possesso, obbligatoria (>0)
        uint256 km;               // km al mint, 0 è un valore valido (es. km zero)
    }

    // tokenId => dati veicolo strutturati (letti anche on-chain, non solo da IPFS)
    mapping(bytes32 => VehicleInfo) public vehicleInfo;

    event VehicleMinted(
        bytes32 indexed tokenId,
        address indexed owner,
        uint256 registrationDate,
        uint256 purchaseDate,
        uint256 km
    );

    event InterventionLogged(
        bytes32 indexed tokenId,
        address indexed loggedBy,
        uint256 date,          // scelta libera dall'utente, anche retroattiva
        uint256 km,
        uint256 amountCents,   // 0 = non specificato
        string description     // testo libero, max 280 char
    );

    /**
     * @param collectionName    es. "MyCarBook"
     * @param collectionSymbol  es. "MCB"
     * @param collectionOwner   owner del CONTRATTO (branding collezione:
     *                          LSP4Metadata di collezione, icona, ecc.) —
     *                          NON è un requisito per mintare un veicolo,
     *                          quello resta permissionless (mint = msg.sender)
     */
    constructor(
        string memory collectionName,
        string memory collectionSymbol,
        address collectionOwner
    )
        LSP8IdentifiableDigitalAsset(
            collectionName,
            collectionSymbol,
            collectionOwner,
            _LSP4_TOKEN_TYPE_NFT,           // 1 = NFT -> Collectibles, non Assets
            _LSP8_TOKENID_FORMAT_NUMBER     // tokenId leggibile, auto-incrementale
        )
    {}

    /**
     * @notice Minta un nuovo veicolo. Chiunque può mintare per se stesso
     *         (msg.sender = owner del token), nessun permesso richiesto.
     * @param vehicleMetadataURI VerifiableURI (LSP4Metadata) già codificato
     *        con ERC725.encodeData lato frontend: contiene LSP4TokenName
     *        libero ("La mia Panda") + attributes marca/modello/allestimento/
     *        targa/VIN (almeno 1 su 5 valorizzato, check fatto in UI) +
     *        icon/images opzionali (aggiungibili anche dopo).
     */
    function mintVehicle(
        uint256 registrationDate,
        uint256 purchaseDate,
        uint256 km,
        bytes memory vehicleMetadataURI
    ) external returns (bytes32 tokenId) {
        require(registrationDate > 0, "Registration date required");
        require(purchaseDate > 0, "Purchase date required");

        tokenId = bytes32(_nextTokenId);
        _nextTokenId++;

        // force=true: nessun controllo su msg.sender essere un contratto
        // in grado di ricevere LSP8 (mint diretto a EOA/UP)
        _mint(msg.sender, tokenId, true, "");

        // scrittura interna (_setDataForTokenId), non la versione esterna
        // onlyOwner-del-contratto: qui il "permesso" è già dato dal fatto
        // che siamo dentro mintVehicle, chiamata liberamente dall'utente
        // sul proprio nuovo token — stesso pattern documentato per Birra20Venti
        _setDataForTokenId(tokenId, _LSP4_METADATA_KEY, vehicleMetadataURI);

        vehicleInfo[tokenId] = VehicleInfo({
            registrationDate: registrationDate,
            purchaseDate: purchaseDate,
            km: km
        });

        emit VehicleMinted(tokenId, msg.sender, registrationDate, purchaseDate, km);
    }

    /**
     * @notice Registra un intervento di manutenzione. Solo l'owner CORRENTE
     *         del token può scrivere — se il veicolo è stato venduto, il
     *         vecchio proprietario non può più aggiungere interventi, ma lo
     *         storico pregresso resta e segue il nuovo proprietario.
     */
    function logIntervention(
        bytes32 tokenId,
        uint256 date,
        uint256 km,
        uint256 amountCents,
        string calldata description
    ) external {
        require(tokenOwnerOf(tokenId) == msg.sender, "Not the current vehicle owner");
        require(
            bytes(description).length <= MAX_DESCRIPTION_LENGTH,
            "Description too long"
        );

        // solo evento, nessuna scrittura in storage: gas costante
        // indipendentemente da quanti interventi accumula il veicolo
        emit InterventionLogged(tokenId, msg.sender, date, km, amountCents, description);
    }

    /**
     * @notice Comodo per il frontend: dati veicolo strutturati in un'unica
     *         chiamata, senza dover leggere separatamente vehicleInfo +
     *         risolvere LSP4Metadata da IPFS per registrationDate/purchaseDate/km.
     */
    function getVehicleInfo(bytes32 tokenId)
        external
        view
        returns (
            address owner,
            uint256 registrationDate,
            uint256 purchaseDate,
            uint256 km
        )
    {
        owner = tokenOwnerOf(tokenId);
        VehicleInfo memory info = vehicleInfo[tokenId];
        return (owner, info.registrationDate, info.purchaseDate, info.km);
    }

    // Lettura lista veicoli di un utente: tokenIdsOf(address) è ereditata
    // da LSP8IdentifiableDigitalAsset (via LSP8Enumerable) — verificare
    // il nome esatto nella versione del pacchetto installata.

    // Storico interventi: NON on-chain in storage per design. Va letto
    // lato frontend con eth_getLogs filtrato su InterventionLogged(tokenId),
    // ordinato per `date` (campo dichiarato, non block.timestamp).
}
