// Simulatore minimo di catena LUKSO + estensione Universal Profile per i
// test end-to-end: risponde alle chiamate JSON-RPC che la pagina fa tramite
// window.lukso, con lo stato del contratto MyCarBookV2 tenuto in memoria.
import { ethers } from "ethers";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const configSrc = readFileSync(fileURLToPath(new URL("../../frontend/config.js", import.meta.url)), "utf8");
const cfg = {};
vm.runInNewContext(configSrc + ";Object.assign(out,{NETWORKS,MYCARBOOK_ABI,MEMBERSHIP_ADDRESSES,LSP4_METADATA_KEY});", { out: cfg });
export const CONFIG = cfg;

const iface = new ethers.Interface(cfg.MYCARBOOK_ABI);
const membershipIface = new ethers.Interface(["function tierOf(address member) external view returns (uint8)"]);
const CONTRACT = cfg.NETWORKS[42].contractAddress.toLowerCase();
const MEMBERSHIP = cfg.MEMBERSHIP_ADDRESSES[42].toLowerCase();

const hex = (n) => "0x" + BigInt(n).toString(16);
const tokenIdOf = (n) => ethers.zeroPadValue(ethers.toBeHex(n), 32);

export class ChainSim {
  constructor({ upAddress, controller }) {
    this.up = ethers.getAddress(upAddress);
    this.controller = controller; // ethers.Wallet che firma per la UP
    this.block = cfg.NETWORKS[42].deploymentBlock + 50_000;
    this.tokens = new Map(); // tokenIdHex -> { owner, regDate, purchaseDate, km, metadata }
    this.next = 1;
    this.logs = [];
    this.txs = new Map();
    this.tiers = new Map();
    this.calls = [];
    this.sent = [];
  }

  setTier(addr, tier) { this.tiers.set(addr.toLowerCase(), tier); }

  addToken({ owner, metadata = "0x", km = 1000n, regDate = 1600000000n, purchaseDate = 1600000000n }) {
    const id = tokenIdOf(this.next++);
    this.tokens.set(id, { owner: ethers.getAddress(owner), metadata, km: BigInt(km), regDate: BigInt(regDate), purchaseDate: BigInt(purchaseDate) });
    return id;
  }

  addInterventionLog({ tokenId, loggedBy, date, km, categoryFlags = 0, amountCents = 0n, description }) {
    const ev = iface.getEvent("InterventionLogged");
    const { topics, data } = iface.encodeEventLog(ev, [tokenId, loggedBy, date, km, categoryFlags, amountCents, description]);
    this.block += 1;
    this.logs.push({ address: cfg.NETWORKS[42].contractAddress, topics, data, blockNumber: this.block });
  }

  count(method) { return this.calls.filter((m) => m === method).length; }

  ethCall({ to, data }) {
    to = to.toLowerCase();
    if (to === MEMBERSHIP) {
      const tx = membershipIface.parseTransaction({ data });
      return membershipIface.encodeFunctionResult("tierOf", [this.tiers.get(tx.args[0].toLowerCase()) || 0]);
    }
    if (to !== CONTRACT) throw new Error("eth_call verso indirizzo sconosciuto " + to);
    const tx = iface.parseTransaction({ data });
    switch (tx.name) {
      case "tokenIdsOf": {
        const owner = tx.args[0].toLowerCase();
        return iface.encodeFunctionResult("tokenIdsOf", [[...this.tokens].filter(([, t]) => t.owner.toLowerCase() === owner).map(([id]) => id)]);
      }
      case "getVehicleInfo": {
        const t = this.tokens.get(tx.args[0]);
        if (!t) throw new Error("token inesistente");
        return iface.encodeFunctionResult("getVehicleInfo", [t.owner, t.regDate, t.purchaseDate, t.km]);
      }
      case "getDataForTokenId": {
        const t = this.tokens.get(tx.args[0]);
        return iface.encodeFunctionResult("getDataForTokenId", [t ? t.metadata : "0x"]);
      }
      case "tokenOwnerOf":
        return iface.encodeFunctionResult("tokenOwnerOf", [this.tokens.get(tx.args[0]).owner]);
      default:
        throw new Error("eth_call non simulata: " + tx.name);
    }
  }

  sendTransaction({ from, to, data }) {
    const tx = iface.parseTransaction({ data });
    this.sent.push({ name: tx.name, args: tx.args });
    if (to.toLowerCase() !== CONTRACT) throw new Error("tx verso indirizzo sconosciuto");
    if (tx.name === "mintVehicle") {
      this.addToken({ owner: from, regDate: tx.args[0], purchaseDate: tx.args[1], km: tx.args[2], metadata: tx.args[3] });
    } else if (tx.name === "logIntervention") {
      const [tokenId, date, km, flags, amount, description] = tx.args;
      const t = this.tokens.get(tokenId);
      if (!t || t.owner.toLowerCase() !== from.toLowerCase()) throw new Error("Not the current vehicle owner");
      if (km > t.km) t.km = km;
      this.addInterventionLog({ tokenId, loggedBy: from, date, km, categoryFlags: flags, amountCents: amount, description });
    } else if (tx.name === "transfer") {
      const [f, toAddr, tokenId, force] = tx.args;
      if (force !== false) throw new Error("atteso force=false");
      this.tokens.get(tokenId).owner = ethers.getAddress(toAddr);
      void f;
    } else {
      throw new Error("tx non simulata: " + tx.name);
    }
    this.block += 1;
    const hash = ethers.keccak256(ethers.toUtf8Bytes(`tx-${this.sent.length}-${data}`));
    this.txs.set(hash, { from, to, data, blockNumber: this.block });
    return hash;
  }

  async handle({ method, params = [] }) {
    this.calls.push(method);
    const blockHash = "0x" + "ab".repeat(32);
    switch (method) {
      case "eth_requestAccounts":
      case "eth_accounts":
        return [this.up];
      case "eth_chainId":
        return "0x2a";
      case "net_version":
        return "42";
      case "eth_blockNumber":
        return hex(this.block);
      case "eth_call":
        return this.ethCall(params[0]);
      case "eth_estimateGas":
        return hex(200000);
      case "eth_gasPrice":
      case "eth_maxPriorityFeePerGas":
        return hex(1000000000);
      case "eth_getBlockByNumber":
        return { number: hex(this.block), hash: blockHash, parentHash: blockHash, timestamp: hex(1700000000), baseFeePerGas: hex(1000000000), gasLimit: hex(30000000), gasUsed: "0x0", miner: ethers.ZeroAddress, extraData: "0x", nonce: "0x0000000000000000", difficulty: "0x0", transactions: [] };
      case "eth_sendTransaction":
        return this.sendTransaction(params[0]);
      case "eth_getTransactionByHash": {
        const t = this.txs.get(params[0]);
        if (!t) return null;
        return { hash: params[0], from: t.from, to: t.to, input: t.data, nonce: "0x1", gas: hex(200000), maxFeePerGas: hex(2e9), maxPriorityFeePerGas: hex(1e9), value: "0x0", blockHash, blockNumber: hex(t.blockNumber), transactionIndex: "0x0", type: "0x2", chainId: "0x2a", accessList: [], r: "0x" + "11".repeat(32), s: "0x" + "22".repeat(32), yParity: "0x0", v: "0x0" };
      }
      case "eth_getTransactionReceipt": {
        const t = this.txs.get(params[0]);
        if (!t) return null;
        return { transactionHash: params[0], blockHash, blockNumber: hex(t.blockNumber), transactionIndex: "0x0", from: t.from, to: t.to, gasUsed: hex(100000), cumulativeGasUsed: hex(100000), effectiveGasPrice: hex(1e9), logs: [], logsBloom: "0x" + "00".repeat(256), status: "0x1", type: "0x2", contractAddress: null };
      }
      case "eth_getLogs": {
        const f = params[0];
        const from = Number(f.fromBlock), to = Number(f.toBlock);
        const topics = f.topics || [];
        return this.logs
          .filter((l) => l.blockNumber >= from && l.blockNumber <= to)
          .filter((l) => topics.every((tp, i) => tp === null || tp === undefined || (Array.isArray(tp) ? tp.includes(l.topics[i]) : tp.toLowerCase() === l.topics[i].toLowerCase())))
          .map((l, i) => ({ ...l, blockNumber: hex(l.blockNumber), blockHash, transactionHash: "0x" + "cd".repeat(32), transactionIndex: "0x0", logIndex: hex(i), removed: false }));
      }
      case "personal_sign": {
        const [msg] = params;
        return this.controller.signMessage(ethers.isHexString(msg) ? ethers.getBytes(msg) : msg);
      }
      default:
        throw new Error("metodo RPC non simulato: " + method);
    }
  }
}

export function encodeMetadataValue(json, url) {
  const hash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(json)));
  return ethers.concat(["0x0000", "0x6f357c6a", "0x0020", hash, ethers.toUtf8Bytes(url)]);
}

export { iface, tokenIdOf };
