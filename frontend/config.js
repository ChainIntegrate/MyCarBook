// MyCarBook — config di rete e ABI
// Aggiornare CONTRACT_ADDRESS per ciascuna rete dopo il deploy (vedi README).

const NETWORKS = {
  4201: {
    name: "LUKSO Testnet",
    rpcUrl: "https://rpc.testnet.lukso.network",
    explorer: "https://explorer.execution.testnet.lukso.network",
    contractAddress: "0x9269184AcDb222e6228e6c1fb603b3811f595497" // TODO dopo deploy testnet
  },
  42: {
    name: "LUKSO Mainnet",
    rpcUrl: "https://rpc.mainnet.lukso.network",
    explorer: "https://explorer.execution.mainnet.lukso.network",
    contractAddress: "0x0000000000000000000000000000000000000000" // TODO dopo deploy mainnet
  }
};

// ABI minima: solo le funzioni/eventi che la UI usa davvero.
const MYCARBOOK_ABI = [
  "function mintVehicle(uint256 registrationDate, uint256 purchaseDate, uint256 km, bytes vehicleMetadataURI) external returns (bytes32 tokenId)",
  "function logIntervention(bytes32 tokenId, uint256 date, uint256 km, uint256 amountCents, string description, bytes32 attachmentHash, string attachmentURI) external",
  "function getVehicleInfo(bytes32 tokenId) external view returns (address owner, uint256 registrationDate, uint256 purchaseDate, uint256 km)",
  "function tokenOwnerOf(bytes32 tokenId) external view returns (address)",
  "function tokenIdsOf(address tokenOwner) external view returns (bytes32[])",
  "function getDataForTokenId(bytes32 tokenId, bytes32 dataKey) external view returns (bytes)",
  "function setData(bytes32 dataKey, bytes calldata dataValue) external",
  "function setDataForTokenId(bytes32 tokenId, bytes32 dataKey, bytes calldata dataValue) external",
  "function owner() external view returns (address)",
  "event VehicleMinted(bytes32 indexed tokenId, address indexed owner, uint256 registrationDate, uint256 purchaseDate, uint256 km)",
  "event InterventionLogged(bytes32 indexed tokenId, address indexed loggedBy, uint256 date, uint256 km, uint256 amountCents, string description, bytes32 attachmentHash, string attachmentURI)"
];

const LSP4_METADATA_KEY =
  "0x9afb95cacc9f95858ec44aa8c3b685511002e30ae54415823f406128b85b238e";

const MAX_DESCRIPTION_LENGTH = 280;
