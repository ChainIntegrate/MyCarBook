"use strict";
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { ethers } = require("ethers");
const { createKubo } = require("../lib/kubo");
const { collectReferencedCids } = require("../lib/cids");

const DEFAULTS = {
  contract: "0x24e9cd569AC99B6DF47CA767508cF63105318195", // MyCarBookV2 mainnet
  fromBlock: 8072041,
  rpc: "https://rpc.mainnet.lukso.network",
  gateways: "https://api.universalprofile.cloud"
};

function setup() {
  if (!process.env.IPFS_API_URL) throw new Error("IPFS_API_URL non impostato");
  const kubo = createKubo({ apiUrl: process.env.IPFS_API_URL, auth: process.env.IPFS_API_AUTH || null });
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL_42 || DEFAULTS.rpc, 42, { staticNetwork: true });
  const contractAddress = process.env.CONTRACT_ADDRESS || DEFAULTS.contract;
  const gateways = (process.env.GATEWAY_FALLBACKS || DEFAULTS.gateways).split(",").map((s) => s.trim()).filter(Boolean);

  async function fetchJson(cid) {
    try {
      return await kubo.catJson(cid);
    } catch {
      for (const gw of gateways) {
        const res = await fetch(`${gw}/ipfs/${cid}`, { signal: AbortSignal.timeout(30000) });
        if (res.ok) return res.json();
      }
      throw new Error("non trovato né sul nodo né sui gateway");
    }
  }

  async function collect(log) {
    const contract = new ethers.Contract(contractAddress, ["function getData(bytes32) view returns (bytes)"], provider);
    return collectReferencedCids({
      contractAddress,
      fromBlock: Number(process.env.DEPLOY_BLOCK || DEFAULTS.fromBlock),
      getLogs: (f) => provider.send("eth_getLogs", [{ address: f.address, fromBlock: ethers.toQuantity(f.fromBlock), toBlock: ethers.toQuantity(f.toBlock) }]),
      getBlockNumber: () => provider.getBlockNumber(),
      getData: (key) => contract.getData(key),
      fetchJson,
      log
    });
  }

  return { kubo, gateways, collect };
}

module.exports = { setup };
