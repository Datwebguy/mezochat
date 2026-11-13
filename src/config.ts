import "dotenv/config";

export type Network = "mainnet" | "testnet";

export const NETWORKS = {
  mainnet: {
    id: 31612,
    name: "Mezo Mainnet",
    rpc: "https://mezo-mainnet.boar.network",
    explorer: "https://explorer.mezo.org",
    musd: "0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186",
    troveManager: "0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193",
    priceFeed: "0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88",
    borrowerOperations: "0x44b1bac67dDA612a41a58AAf779143B181dEe031",
  },
  testnet: {
    id: 31611,
    name: "Mezo Testnet",
    rpc: "https://rpc.test.mezo.org",
    explorer: "https://explorer.test.mezo.org",
    musd: "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503",
    troveManager: "0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0",
    priceFeed: "0x86bCF0841622a5dAC14A313a15f96A95421b9366",
    borrowerOperations: "0xCdF7028ceAB81fA0C6971208e83fa7872994beE5",
  },
} as const;

const network = (process.env.MEZO_NETWORK ?? "testnet") as Network;
if (!(network in NETWORKS)) throw new Error(`MEZO_NETWORK must be mainnet or testnet`);

export const config = {
  network,
  chain: NETWORKS[network],
  rpcUrl: process.env.MEZO_RPC_URL || NETWORKS[network].rpc,
  botToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  dataFile: process.env.DATA_FILE ?? "data/db.json",
  defaultThreshold: 150,
};
