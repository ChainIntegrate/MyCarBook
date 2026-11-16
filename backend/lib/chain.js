"use strict";
const { ethers } = require("ethers");

const MEMBERSHIP_ABI = ["function tierOf(address member) external view returns (uint8)"];
const UP_ABI = ["function isValidSignature(bytes32 hash, bytes memory signature) public view returns (bytes4)"];
const ERC1271_MAGIC_VALUE = "0x1626ba7e";

// Accesso in sola lettura alla catena: firma ERC-1271 e tier membership.
function createChain(config) {
  const providers = {};
  function provider(chainId) {
    if (!providers[chainId]) {
      providers[chainId] = new ethers.JsonRpcProvider(config.rpcUrls[chainId], chainId, { staticNetwork: true });
    }
    return providers[chainId];
  }
  return {
    async isValidSignature(chainId, address, hash, signature) {
      const up = new ethers.Contract(address, UP_ABI, provider(chainId));
      const result = await up.isValidSignature(hash, signature);
      return String(result).toLowerCase() === ERC1271_MAGIC_VALUE;
    },
    async tierOf(chainId, address) {
      const membership = config.membershipAddresses[chainId];
      if (!membership) return 0;
      const c = new ethers.Contract(membership, MEMBERSHIP_ABI, provider(chainId));
      return Number(await c.tierOf(address));
    }
  };
}

module.exports = { createChain, ERC1271_MAGIC_VALUE };
